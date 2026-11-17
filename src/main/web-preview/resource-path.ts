import { posix } from "node:path";
import { remotePathSchema } from "../../shared/files";
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
export function resourcePath(
  url: string,
  token: string,
  root: string,
): { path: string; mime: string } {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "sshos-web:" ||
    parsed.hostname !== token ||
    parsed.username ||
    parsed.password ||
    parsed.port
  )
    throw new Error("ASSET_DENIED");
  const decoded = decodeURIComponent(parsed.pathname);
  if (
    decoded.includes("\\") ||
    decoded.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("ASSET_DENIED");
  const path = remotePathSchema.parse(posix.join(root, decoded));
  if (root !== "/" && !path.startsWith(root + "/"))
    throw new Error("ASSET_DENIED");
  const mime = types[posix.extname(path).toLowerCase()];
  if (!mime) throw new Error("PATH_UNSUPPORTED");
  return { path, mime };
}
export function previewURL(token: string, root: string, path: string): string {
  if (root !== "/" && !path.startsWith(root + "/"))
    throw new Error("ASSET_DENIED");
  const relative = root === "/" ? path.slice(1) : path.slice(root.length + 1);
  return `sshos-web://${token}/${relative.split("/").map(encodeURIComponent).join("/")}`;
}
