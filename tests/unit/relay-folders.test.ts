import { describe, expect, it, vi } from "vitest";
import type { EngineGateway } from "../../src/main/engine-gateway";
import type { ConnectionController } from "../../src/main/connections/connections";
import { RelayFolders } from "../../src/main/transfers/relay-folders";

const token = crypto.randomUUID(),
  snapshot = crypto.randomUUID();
const row = (rawName: string, type = "directory", operable = true) => ({
  rawName,
  type,
  operable,
  name: rawName,
  mode: null,
  size: null,
  mtime: null,
});
function page(
  entries: ReturnType<typeof row>[],
  offset = 0,
  nextOffset: number | null = null,
) {
  return {
    entries,
    offset,
    nextOffset,
    path: "/dst",
    snapshotId: snapshot,
    listedAt: new Date().toISOString(),
    total: 250,
    partial: true,
  };
}
function setup(answer: (q: any) => unknown) {
  const capability = vi.fn(() => ({
    serverId: crypto.randomUUID(),
    generation: 1,
  }));
  const request = vi.fn(async (q: any) => answer(q));
  const folders = new RelayFolders(
    { sessionCapability: capability } as unknown as ConnectionController,
    { request } as unknown as EngineGateway,
  );
  return {
    folders,
    capability,
    request,
    list: (offset: number, path = "/dst", sessionToken = token) =>
      folders.list({ sessionToken, path, offset }),
  };
}
describe("server-copy destination folder picker", () => {
  it("reuses only the bound listing for subsequent pages, skips unusable entries and closes its own browser", async () => {
    const names = Array.from({ length: 133 }, (_, i) => "folder-" + i);
    const f = setup((q) => {
      if (q.action === "file:list")
        return page(
          names.map((n) => row(n)),
          0,
          133,
        );
      if (q.action === "file:page") {
        expect(q.snapshotId).toBe(snapshot);
        expect(q.offset).toBe(133);
        return page(
          [
            row("end"),
            row(".."),
            row("locked", "directory", false),
            row("ignore", "file"),
          ],
          133,
          137,
        );
      }
      if (q.action === "file:close") return;
      throw Error("unexpected action");
    });
    expect(await f.list(0)).toEqual({
      path: "/dst",
      directories: names.slice(0, 128),
      nextOffset: 128,
      partial: true,
    });
    expect(await f.list(128)).toEqual({
      path: "/dst",
      directories: [...names.slice(128), "end"],
      nextOffset: null,
      partial: true,
    });
    expect(f.request.mock.calls.map(([q]) => q.action)).toEqual([
      "file:list",
      "file:page",
      "file:close",
    ]);
    expect(new Set(f.request.mock.calls.map(([q]) => q.browserId)).size).toBe(
      1,
    );
    for (const args of [
      [2, "/other", token],
      [2, "/dst", crypto.randomUUID()],
      [135, "/dst", token],
    ] as const)
      await expect(f.list(...args)).rejects.toThrow("TOKEN_EXPIRED");
    f.folders.invalidate();
    await expect(f.list(1)).rejects.toThrow("TOKEN_EXPIRED");
    await expect(f.list(-1)).rejects.toThrow();
  });
  it("discards a superseded read and returns the new one even if closing the old browser fails", async () => {
    let resolve!: (p: unknown) => void,
      opened = 0;
    const f = setup((q) => {
      if (q.action === "file:close") throw Error("CONNECTION_LOST");
      if (opened++ === 0)
        return new Promise((done) => {
          resolve = done;
        });
      return page([]);
    });
    const old = f.list(0);
    expect(await f.list(0)).toEqual({
      path: "/dst",
      directories: [],
      nextOffset: null,
      partial: true,
    });
    resolve(page([row("old")]));
    await expect(old).rejects.toThrow("REQUEST_CANCELLED");
    expect(
      f.request.mock.calls.filter(([q]) => q.action === "file:close"),
    ).toHaveLength(2);
  });
  it("rechecks session authority after remote reads and releases the browsing capability on failure", async () => {
    const f = setup((q) =>
      q.action === "file:list" ? page([row("private")]) : undefined,
    );
    f.capability
      .mockImplementationOnce(() => ({
        serverId: crypto.randomUUID(),
        generation: 1,
      }))
      .mockImplementationOnce(() => {
        throw Error("TOKEN_EXPIRED");
      });
    await expect(f.list(0)).rejects.toThrow("TOKEN_EXPIRED");
    await expect(f.list(1)).rejects.toThrow("TOKEN_EXPIRED");
    expect(f.request.mock.calls.at(-1)?.[0].action).toBe("file:close");
  });
  it("checks the requested path, exact snapshot, offset and forward progress of remote pages", async () => {
    for (const invalid of [
      { first: { path: "/other" } },
      { first: { offset: 7 } },
      { first: { nextOffset: 0 } },
      { second: { snapshotId: crypto.randomUUID() } },
      { second: { offset: 15 } },
      { second: { path: "/other" } },
    ]) {
      const f = setup((q) => {
        if (q.action === "file:list")
          return { ...page([row("one")], 0, 1), ...invalid.first };
        if (q.action === "file:page")
          return { ...page([row("two")], 1), ...invalid.second };
      });
      await expect(f.list(0)).rejects.toThrow("PATH_CHANGED");
      expect(f.request.mock.calls.at(-1)?.[0].action).toBe("file:close");
      await expect(f.list(1)).rejects.toThrow("TOKEN_EXPIRED");
    }
  });
  it("does not return a different listing if a second request finishes while the first browser closes", async () => {
    let release!: () => void,
      closing = 0;
    const closeStarted = Promise.withResolvers<void>();
    const f = setup((q) => {
      if (q.action === "file:list") return page([row(closing ? "new" : "old")]);
      if (q.action === "file:close" && closing++ === 0) {
        closeStarted.resolve();
        return new Promise<void>((done) => {
          release = done;
        });
      }
    });
    const old = f.list(0);
    await closeStarted.promise;
    expect((await f.list(0)).directories).toEqual(["new"]);
    release();
    await expect(old).rejects.toThrow("REQUEST_CANCELLED");
  });
});
