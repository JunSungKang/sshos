export function identifyOS(
  bytes: Buffer,
): "supported" | "unsupported" | "unknown" {
  if (bytes.length > 16384) return "unknown";
  const text = new TextDecoder("utf-8", { fatal: true });
  let input: string;
  try {
    input = text.decode(bytes);
  } catch {
    return "unknown";
  }
  const found = new Map<string, string>();
  for (const line of input.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const match =
      /^(ID|VERSION_ID)=(?:"([^"\\]*)"|'([^'\\]*)'|([a-zA-Z0-9._-]+))$/.exec(
        line,
      );
    if (!match) {
      if (/^(ID|VERSION_ID)=/.test(line)) return "unknown";
      continue;
    }
    const key = match[1]!;
    if (found.has(key)) return "unknown";
    found.set(key, match[2] ?? match[3] ?? match[4] ?? "");
  }
  if (!found.has("ID") || !found.has("VERSION_ID")) return "unknown";
  return found.get("ID") === "ubuntu" && found.get("VERSION_ID") === "24.04"
    ? "supported"
    : "unsupported";
}
