const MAX_KEY_BYTES = 512 * 1024;

class SSHReader {
  offset = 0;
  constructor(readonly bytes: Buffer) {}
  uint32(): number {
    if (this.offset + 4 > this.bytes.length) throw new Error("KEY_INVALID");
    const result = this.bytes.readUInt32BE(this.offset);
    this.offset += 4;
    return result;
  }
  string(): Buffer {
    const size = this.uint32();
    if (size > this.bytes.length - this.offset) throw new Error("KEY_INVALID");
    const value = this.bytes.subarray(this.offset, this.offset + size);
    this.offset += size;
    return value;
  }
}

/** Bound expensive bcrypt work before allowing ssh2 to parse/decrypt the key. */
export function inspectPrivateKey(bytes: Buffer): void {
  if (bytes.length === 0 || bytes.length > MAX_KEY_BYTES)
    throw new Error("KEY_INVALID");
  const text = bytes.toString("utf8").trim();
  if (
    text.startsWith("-----BEGIN RSA PRIVATE KEY-----") &&
    text.endsWith("-----END RSA PRIVATE KEY-----")
  )
    return;
  const match =
    /^-----BEGIN OPENSSH PRIVATE KEY-----\s+([A-Za-z0-9+/=\r\n]+)-----END OPENSSH PRIVATE KEY-----$/.exec(
      text,
    );
  if (!match?.[1]) throw new Error("AUTH_UNSUPPORTED");
  const base64 = match[1].replace(/[\r\n]/g, "");
  const binary = Buffer.from(base64, "base64");
  try {
    if (
      binary.toString("base64").replace(/=+$/, "") !== base64.replace(/=+$/, "")
    )
      throw new Error("KEY_INVALID");
    const magic = Buffer.from("openssh-key-v1\0");
    if (!binary.subarray(0, magic.length).equals(magic))
      throw new Error("KEY_INVALID");
    const reader = new SSHReader(binary);
    reader.offset = magic.length;
    const cipher = reader.string().toString("ascii");
    const kdf = reader.string().toString("ascii");
    const options = reader.string();
    if (cipher === "none") {
      if (kdf !== "none" || options.length !== 0)
        throw new Error("KEY_INVALID");
    } else {
      if (kdf !== "bcrypt") throw new Error("KEY_INVALID");
      const params = new SSHReader(options);
      params.string();
      const rounds = params.uint32();
      if (rounds < 1 || rounds > 100 || params.offset !== options.length)
        throw new Error("KEY_INVALID");
    }
    if (reader.uint32() !== 1) throw new Error("KEY_INVALID");
    reader.string();
    reader.string();
    if (reader.offset !== binary.length) throw new Error("KEY_INVALID");
  } finally {
    binary.fill(0);
  }
}
