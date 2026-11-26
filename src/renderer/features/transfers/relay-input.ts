import type { EntryView } from "../../../shared/files";
import type { SessionView } from "../../../shared/session-contracts";

export const relayDragType = "application/x-sshos-relay";

export type RelaySource = {
  entryToken: string;
  serverId: string;
  generation: number;
  name: string;
  path: string;
};

export function canRelay(
  session?: SessionView,
): session is SessionView & { sessionToken: string } {
  return Boolean(
    session?.status === "connected" &&
      session.sessionToken &&
      session.sftp === "available" &&
      (session.os === "supported" ||
        (session.os === "unknown" && session.osConfirmed)),
  );
}

export function joinRemotePath(directory: string, name: string) {
  return directory === "/" ? "/" + name : directory + "/" + name;
}

export function relaySource(
  session: SessionView | undefined,
  generation: number,
  directory: string | undefined,
  entry: EntryView,
): RelaySource | null {
  if (
    !canRelay(session) ||
    session.generation !== generation ||
    !directory ||
    entry.type !== "file" ||
    !entry.operable ||
    !entry.entryToken
  )
    return null;
  return {
    entryToken: entry.entryToken,
    serverId: session.serverId,
    generation,
    name: entry.name,
    path: joinRemotePath(directory, entry.name),
  };
}

// A drag carries an opaque, per-gesture nonce. The file capability stays in the app.
export function acceptsRelayDrag(
  types: readonly string[],
  heldNonce: string | null,
) {
  return Boolean(heldNonce && types.length === 1 && types[0] === relayDragType);
}
