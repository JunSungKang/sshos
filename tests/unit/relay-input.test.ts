import { expect, it } from "vitest";
import type { EntryView } from "../../src/shared/files";
import type { SessionView } from "../../src/shared/session-contracts";
import {
  acceptsRelayDrag,
  canRelay,
  joinRemotePath,
  relayDragType,
  relaySource,
} from "../../src/renderer/features/transfers/relay-input";
const session: SessionView = {
  serverId: "A",
  generation: 2,
  serverName: "origin",
  host: "fixture",
  port: 22,
  username: "reader",
  status: "connected",
  sessionToken: "session",
  sftp: "available",
  os: "supported",
  osConfirmed: false,
  initialPath: "/",
  errorCode: null,
};
const file: EntryView = {
  name: "한 글.bin",
  type: "file",
  operable: true,
  size: 12,
  mtime: 0,
  mode: 420,
  gid: null,
  uid: null,
  entryToken: "source",
  directoryToken: null,
};
it("only starts from a regular operable file in the originating eligible generation", () => {
  expect(relaySource(session, 2, "/", file)).toEqual({
    entryToken: "source",
    serverId: "A",
    generation: 2,
    name: "한 글.bin",
    path: "/한 글.bin",
  });
  expect(joinRemotePath("/home", "한 글.bin")).toBe("/home/한 글.bin");
  for (const type of ["directory", "symlink", "special", "unknown"] as const)
    expect(relaySource(session, 2, "/", { ...file, type })).toBeNull();
  expect(relaySource(session, 1, "/", file)).toBeNull();
  expect(relaySource(session, 2, undefined, file)).toBeNull();
  expect(relaySource(session, 2, "/", { ...file, operable: false })).toBeNull();
  expect(
    relaySource(session, 2, "/", { ...file, entryToken: null }),
  ).toBeNull();
  expect(canRelay({ ...session, os: "unknown", osConfirmed: true })).toBe(true);
  for (const override of [
    { os: "unknown" },
    { os: "unsupported", osConfirmed: true },
    { sessionToken: null },
    { status: "disconnected" },
    { sftp: "unavailable" },
  ] as const)
    expect(canRelay({ ...session, ...override })).toBe(false);
});
it("requires an app drag and refuses OS files, URI lists, text, and mixed types", () => {
  expect(acceptsRelayDrag([relayDragType], "nonce")).toBe(true);
  for (const types of [
    [],
    ["Files"],
    ["text/plain"],
    ["text/uri-list"],
    ["Files", relayDragType],
    [relayDragType, "text/plain"],
  ])
    expect(acceptsRelayDrag(types, "nonce")).toBe(false);
  expect(acceptsRelayDrag([relayDragType], null)).toBe(false);
});
