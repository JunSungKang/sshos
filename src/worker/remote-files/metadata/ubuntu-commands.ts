import { posix } from "node:path";
import { remotePathSchema } from "../../../shared/files";
const nulEscape = String.fromCharCode(92) + "0";
export function quotePath(path: string): string {
  return (
    "'" +
    remotePathSchema
      .parse(path)
      .replaceAll("'", "'" + String.fromCharCode(92) + "''") +
    "'"
  );
}
export const LIST_FIELDS = ["%f", "%y", "%s", "%T@", "%m", "%U", "%G", ""].join(
  nulEscape,
);
export function directoryCommand(path: string): string {
  const p = quotePath(path);
  return `LC_ALL=C; export LC_ALL; test ! -L ${p} && test -d ${p} && /usr/bin/realpath -ze -- ${p}`;
}
export function listCommand(path: string): string {
  return `${directoryCommand(path)} && /usr/bin/find -P ${quotePath(path)} -mindepth 1 -maxdepth 1 -printf '${LIST_FIELDS}'`;
}
export function propertiesCommand(path: string): string {
  const format = ["%f", "%s", "%Y", "%u", "%g", "%i", "%d", "%h", ""].join(
    nulEscape,
  );
  const parent = quotePath(posix.dirname(path));
  return `LC_ALL=C; export LC_ALL; test "$(/usr/bin/realpath -e -- ${parent})" = ${parent} && /usr/bin/stat --printf='${format}' -- ${quotePath(path)}`;
}
export const OS_COMMAND = "/usr/bin/head -c 16385 -- /etc/os-release";
export const START_COMMAND = "/usr/bin/realpath -ze -- .";
