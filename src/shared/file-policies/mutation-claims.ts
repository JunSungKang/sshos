import type { MutationSpec } from "../mutations";
import type { PathClaim } from "./path-locks";
export function mutationClaims(spec: MutationSpec): PathClaim[] {
  return [
    { path: spec.parent, mode: "keep" },
    ...[spec.source, spec.destination].flatMap((path) =>
      path ? [{ path, mode: "write" as const }] : [],
    ),
  ];
}
