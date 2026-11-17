import { describe, expect, it } from "vitest";
import { ExecutionSlots } from "../../src/worker/execution/slots";
import {
  PathLocks,
  claimsConflict,
} from "../../src/shared/file-policies/path-locks";
import {
  localPathLockKey,
  transferClaims,
} from "../../src/shared/file-policies/transfer-claims";
import { transferReceipt } from "../fixtures/transfers";
describe("execution reservations and path ownership", () => {
  it("counts opening/closing reservations until closed and rejects duplicate/foreign/stale slot ownership", () => {
    const slots = new ExecutionSlots();
    for (let i = 0; i < 4; i++) slots.reserve(`a${i}`, "server-a", 1);
    expect(slots.count()).toBe(4);
    expect(slots.count("server-a")).toBe(4);
    expect(slots.count("other")).toBe(0);
    expect(() => slots.reserve("a0", "server-a", 1)).toThrow("INPUT_INVALID");
    expect(() => slots.reserve("a4", "server-a", 1)).toThrow("SESSION_LIMIT");
    slots.reserve("b", "server-b", 2);
    slots.reserve("c", "server-c", 1);
    expect(() => slots.reserve("d", "server-d", 1)).toThrow("SESSION_LIMIT");
    expect(() => slots.require("a0", "server-a", 1)).not.toThrow();
    for (const [id, server, generation] of [
      ["missing", "server-a", 1],
      ["a0", "server-b", 1],
      ["a0", "server-a", 2],
    ] as const)
      expect(() => slots.require(id, server, generation)).toThrow(
        "TOKEN_EXPIRED",
      );
    slots.closed("a0");
    slots.closed("a0");
    expect(slots.count()).toBe(5);
    slots.reserve("new", "server-a", 2);
    expect(slots.count("server-a")).toBe(4);
  });
  it("keeps root/ancestor write restrictions and requires an exact idempotent lock reservation", () => {
    const locks = new PathLocks(),
      claims = [
        { path: "/a/item", mode: "write" as const },
        { path: "/a", mode: "keep" as const },
      ];
    expect(locks.acquire("one", "server-a", claims)).toBe(true);
    expect(locks.acquire("one", "server-a", claims)).toBe(true);
    expect(() => locks.acquire("one", "server-b", claims)).toThrow(
      "INPUT_INVALID",
    );
    expect(() =>
      locks.acquire("one", "server-a", [{ path: "/other", mode: "write" }]),
    ).toThrow("INPUT_INVALID");
    expect(
      locks.acquire("blocked", "server-a", [{ path: "/", mode: "write" }]),
    ).toBe(false);
    expect(
      locks.acquire("other-server", "server-b", [{ path: "/", mode: "write" }]),
    ).toBe(true);
    expect(
      locks.acquire("sibling", "server-a", [
        { path: "/a/other", mode: "write" },
        { path: "/a", mode: "keep" },
      ]),
    ).toBe(true);
    expect(
      claimsConflict(
        [{ path: "/", mode: "keep" }],
        [{ path: "/a", mode: "keep" }],
      ),
    ).toBe(false);
    expect(claimsConflict([], [{ path: "/", mode: "write" }])).toBe(false);
    locks.release("one");
    locks.release("sibling");
    expect(
      locks.acquire("root", "server-a", [{ path: "/", mode: "write" }]),
    ).toBe(true);
  });
  it("folds Windows/mac local aliases only for claims and leaves actual transfer paths intact", () => {
    expect(localPathLockKey("C:\\Data\\É.txt")).toBe(
      localPathLockKey("c:/data/e\u0301.txt"),
    );
    expect(localPathLockKey("/Users/A/É.txt")).toBe("/users/a/e\u0301.txt");
    for (const direction of ["upload", "download"] as const) {
      const row = transferReceipt(direction),
        before = structuredClone(row),
        claims = transferClaims(row);
      expect(claims.remote[0]).toEqual({
        path: row.remoteParent,
        mode: "keep",
      });
      expect(claims.local[0]?.mode).toBe("keep");
      expect(row).toEqual(before);
      expect(claims.remote.length).toBe(direction === "upload" ? 3 : 2);
    }
  });
});
