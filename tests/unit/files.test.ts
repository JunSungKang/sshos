import { describe, it, expect, vi, afterEach } from "vitest";
import { FileBrowser } from "../../src/worker/remote-files/browser";
import {
  parseListing,
  parseProperties,
  canonicalPath,
  UbuntuMetadata,
} from "../../src/worker/remote-files/metadata/ubuntu-metadata";
import {
  quotePath,
  listCommand,
  propertiesCommand,
  LIST_FIELDS,
} from "../../src/worker/remote-files/metadata/ubuntu-commands";
import {
  runCommand,
  successful,
} from "../../src/worker/remote-files/metadata/command-runner";
import { validName, remotePathSchema } from "../../src/shared/files";
import { commandFixture } from "./helpers-command";
const listing = (names: [string, string][], path = "/home") =>
  Buffer.from(
    [
      path,
      ...names.flatMap(([name, kind]) => [
        name,
        kind,
        "1",
        "2.000",
        "600",
        "1000",
        "1000",
      ]),
      "",
    ].join("\0"),
  );
afterEach(() => vi.useRealTimers());
describe("SSH metadata framing and command isolation", () => {
  it("quotes all shell metacharacters without evaluating names and emits single-backslash NUL escapes", () => {
    expect(quotePath("/home/a'b")).toBe(
      "'/home/a'" + String.fromCharCode(92) + "''b'",
    );
    expect(quotePath("/home/$(touch x); &`x`")).toBe(
      "'/home/$(touch x); &`x`'",
    );
    expect(LIST_FIELDS).toBe(
      ["%f", "%y", "%s", "%T@", "%m", "%U", "%G", ""].join(
        String.fromCharCode(92) + "0",
      ),
    );
    expect(() => quotePath("/home/../etc")).toThrow();
  });
  it("keeps precise Unicode and displays unsafe names without operation authority", () => {
    for (const name of ["한글", "é", "e\u0301", "emoji😀", "<script>.txt"])
      expect(validName(name)).toBe(true);
    for (const name of [
      "",
      "..",
      ".",
      "a/b",
      "a\0b",
      "x\ufffd",
      "x\u202e",
      "a".repeat(256),
      "\ud800",
    ])
      expect(validName(name)).toBe(false);
    expect(remotePathSchema.safeParse("/home/../etc").success).toBe(false);
    const { rows } = parseListing(
      listing([
        ["a b", "f"],
        ["x\nfile", "f"],
        ["link", "l"],
        ["pipe", "p"],
      ]),
      "/home",
    );
    expect(rows[0]?.rawName).toBe("a b");
    expect(rows[1]).toMatchObject({ rawName: "", operable: false });
    expect(rows[2]?.operable).toBe(false);
    expect(rows[3]?.type).toBe("special");
  });
  it("refuses malformed numeric fields, partial records, banners and changed paths", () => {
    for (const data of [
      listing([["ok", "f"]]).subarray(0, -1),
      Buffer.from("banner\0"),
      listing([["ok", "f"]]).map((x) => (x === 50 ? 120 : x)),
    ])
      expect(() => parseListing(data, "/home")).toThrow();
    expect(() => parseListing(listing([]), "/else")).toThrow("PATH_CHANGED");
    expect(() => parseListing(listing([["a/b", "f"]]), "/home")).toThrow();
    expect(() => canonicalPath(Buffer.from("/home\0noise"))).toThrow();
    expect(canonicalPath(Buffer.from("/home\0"))).toBe("/home");
  });
  it("returns complete records only for a bounded truncated stream", () => {
    const bytes = Buffer.concat([
      listing([["one", "f"]]).subarray(0, -1),
      Buffer.from("\0unfinished"),
    ]);
    expect(parseListing(bytes, "/home", true)).toMatchObject({
      partial: true,
      rows: [{ name: "one" }],
    });
    const many = listing(
      Array.from({ length: 10001 }, (_, i) => ["f" + i, "f"]),
    );
    expect(parseListing(many, "/home")).toMatchObject({
      partial: true,
      rows: expect.arrayContaining([
        {
          rawName: "f0",
          name: "f0",
          type: "file",
          operable: true,
          size: 1,
          mtime: 2,
          mode: 384,
          uid: 1000,
          gid: 1000,
        },
      ]),
    });
    expect(parseListing(many, "/home").rows).toHaveLength(10000);
  });
  it("parses exact properties including inode identity, rejects malformed fields", () => {
    const data = Buffer.from(
      ["81a4", "3", "2", "1000", "1000", "12", "1", "1", ""].join("\0"),
    );
    expect(parseProperties(data, "/home/f")).toMatchObject({
      type: "file",
      mode: 0o644,
      inode: "12",
      device: "1",
    });
    expect(() => parseProperties(Buffer.from("bad"), "/home/f")).toThrow();
  });
  it("runs one non-PTY command per listing and reuses cached pages with sorted folders first", async () => {
    const f = commandFixture(() => ({
        bytes: listing([
          ["z", "f"],
          ["b", "d"],
          ["a", "d"],
        ]),
      })),
      browser = new FileBrowser(() => f.access);
    const page = await browser.list("s", 1, "b", "/home");
    expect(page.entries.map((e) => e.name)).toEqual(["a", "b", "z"]);
    expect(f.commands).toEqual([listCommand("/home")]);
    expect(browser.page("s", 1, "b", 0, page.snapshotId)).toEqual(page);
    expect(() => browser.page("s", 2, "b", 0)).toThrow("TOKEN_EXPIRED");
    expect(() => browser.page("s", 1, "b", 4)).toThrow("TOKEN_EXPIRED");
    browser.close("b");
    expect(() => browser.page("s", 1, "b", 0)).toThrow();
  });
  it("bounds snapshots without eviction and refuses concurrent browser work", async () => {
    const f = commandFixture(() => ({ bytes: listing([]) })),
      browser = new FileBrowser(() => f.access);
    for (let i = 0; i < 9; i++) await browser.list("s", 1, "b" + i, "/home");
    await expect(browser.list("s", 1, "overflow", "/home")).rejects.toThrow(
      "WINDOW_LIMIT",
    );
    browser.close("b0");
    await browser.list("s", 1, "overflow", "/home");
  });
  it("discards cancelled and stale replies", async () => {
    let done!: Function;
    const f = commandFixture(
        () =>
          new Promise((resolve) => {
            done = resolve;
          }),
      ),
      browser = new FileBrowser(() => f.access);
    const pending = browser.list("s", 1, "b", "/home");
    await expect(browser.list("s", 1, "b", "/home")).rejects.toThrow(
      "REQUEST_BUSY",
    );
    browser.close("b");
    done({ bytes: listing([]) });
    await expect(pending).rejects.toThrow("REQUEST_CANCELLED");
    const g = commandFixture(() => {
      g.stop();
      return { bytes: listing([]) };
    });
    await expect(runCommand(g.access, "fixed")).rejects.toThrow(
      "CONNECTION_LOST",
    );
  });
  it("checks status/stderr, enforces byte limits and maps rejected exec without remote text", async () => {
    for (const reply of [{ code: 1 }, { stderr: true }]) {
      const f = commandFixture(() => reply);
      await expect(new UbuntuMetadata(f.access).list("/home")).rejects.toThrow(
        "COMMAND_FAILED",
      );
    }
    const f = commandFixture(() => ({ bytes: Buffer.alloc(200, 65) }));
    expect(await runCommand(f.access, "fixed", 10)).toMatchObject({
      truncated: true,
      bytes: Buffer.alloc(10, 65),
    });
    expect(() =>
      successful({
        bytes: Buffer.alloc(0),
        code: 1,
        stderr: false,
        truncated: false,
      }),
    ).toThrow();
    const g = commandFixture(() => ({ error: true }));
    await expect(runCommand(g.access, "fixed")).rejects.toThrow(
      "CONNECTION_LOST",
    );
  });
  it("times out a stalled channel and quarantines its owning generation", async () => {
    vi.useFakeTimers();
    const f = commandFixture(() => ({ hang: true }));
    const pending = runCommand(f.access, "fixed", 10, 15),
      rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(16);
    await rejected;
    expect(f.stopped).toBe(true);
  });
  it("uses fixed property and canonical-directory commands", async () => {
    const f = commandFixture((command) => ({
      bytes:
        command === propertiesCommand("/home/f")
          ? Buffer.from(
              ["81a4", "3", "2", "1000", "1000", "12", "1", "1", ""].join("\0"),
            )
          : Buffer.from("/home\0"),
    }));
    const metadata = new UbuntuMetadata(f.access);
    await metadata.verifyDirectory("/home");
    expect(await metadata.properties("/home/f")).toMatchObject({
      path: "/home/f",
      type: "file",
    });
  });
});
it("rejects out of range metadata, broken types and malformed property integers", () => {
  for (const fields of [
    ["f", "9007199254740992", "1", "600", "0", "0"],
    ["f", "1", "9007199254740992", "600", "0", "0"],
    ["f", "1", "1", "17777", "0", "0"],
    ["x", "1", "1", "600", "0", "0"],
    ["f", "1", "1", "600", "-1", "0"],
  ])
    expect(() =>
      parseListing(
        Buffer.from(["/home", "name", ...fields, ""].join("\0")),
        "/home",
      ),
    ).toThrow();
  for (const mode of ["41ed", "a1ff", "11a4"])
    expect(
      parseProperties(
        Buffer.from([mode, "0", "1", "0", "0", "1", "1", "1", ""].join("\0")),
        "/home",
      ).type,
    ).not.toBe("file");
  expect(() =>
    parseProperties(
      Buffer.from(
        ["bad-mode", "0", "1", "0", "0", "1", "1", "1", ""].join("\0"),
      ),
      "/home",
    ),
  ).toThrow();
});
it("retains metadata ownership after channel error until actual closure", async () => {
  const { EventEmitter } = await import("node:events");
  const stream = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    close: vi.fn(),
  });
  const access = {
    client: { exec: (_command: string, done: Function) => done(null, stream) },
    check() {},
    quarantine: vi.fn(),
  } as any;
  const waiting = runCommand(access, "fixed");
  let settled = false;
  const rejected = expect(waiting).rejects.toThrow("CONNECTION_LOST");
  void waiting.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  stream.emit("error", Error("untrusted remote detail"));
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(stream.close).toHaveBeenCalledOnce();
  stream.emit("close");
  await rejected;
});
