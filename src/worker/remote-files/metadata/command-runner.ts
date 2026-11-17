import type { Client, ClientChannel } from "ssh2";
export interface CommandAccess {
  client: Client;
  check(): void;
  quarantine(): void;
}
export type CommandResult = {
  bytes: Buffer;
  code: number | null;
  truncated: boolean;
  stderr: boolean;
};
/** Bounded non-PTY channel on the authenticated control connection. Never logs commands/output. */
export function runCommand(
  access: CommandAccess,
  command: string,
  limit = 10 * 1024 * 1024,
  timeout = 60000,
): Promise<CommandResult> {
  access.check();
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | null = null,
      settled = false,
      ended = false,
      code: number | null = null,
      size = 0,
      truncated = false,
      stderr = false;
    let channelFailure: Error | undefined;
    const parts: Buffer[] = [];
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else {
        try {
          access.check();
          resolve({
            bytes: Buffer.concat(parts, size),
            code,
            truncated,
            stderr,
          });
        } catch (e) {
          reject(e);
        }
      }
    };
    const timer = setTimeout(() => {
      channelFailure = new Error("IO_TIMEOUT");
      channel?.close();
      access.quarantine();
      finish(channelFailure);
    }, timeout);
    try {
      access.client.exec(command, (error, stream) => {
        if (settled) {
          stream?.close();
          return;
        }
        if (error) {
          finish(new Error("COMMAND_UNAVAILABLE"));
          return;
        }
        channel = stream;
        stream.on("data", (part: Buffer) => {
          if (settled || truncated) return;
          const left = limit - size;
          if (part.length > left) {
            if (left) {
              parts.push(part.subarray(0, left));
              size += left;
            }
            truncated = true;
            stream.close();
            return;
          }
          parts.push(Buffer.from(part));
          size += part.length;
        });
        stream.stderr.on("data", () => {
          stderr = true;
        });
        stream.on("exit", (status: number | null) => {
          code = status;
        });
        stream.on("end", () => {
          ended = true;
        });
        stream.on("error", () => {
          channelFailure = new Error("CONNECTION_LOST");
          stream.close();
        });
        stream.on("close", () => {
          if (channelFailure) {
            finish(channelFailure);
            return;
          }
          if (!truncated && !ended) {
            finish(new Error("CONNECTION_LOST"));
            return;
          }
          finish();
        });
      });
    } catch {
      finish(new Error("COMMAND_UNAVAILABLE"));
    }
  });
}
export function successful(result: CommandResult): Buffer {
  if (result.truncated || result.stderr || result.code !== 0)
    throw new Error("COMMAND_FAILED");
  return result.bytes;
}
