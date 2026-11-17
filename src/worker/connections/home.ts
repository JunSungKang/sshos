import type { Client } from "ssh2";
import { remotePathSchema } from "../../shared/files";
export const HOME_COMMAND =
  'u=$(id -u) && printf \'%s\\n\' "$u" && getent passwd "$u"';
export function parseHome(bytes: Uint8Array): string {
  if (bytes.byteLength > 16384) throw new Error("PATH_UNSUPPORTED");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error("PATH_UNSUPPORTED");
  const lines = text.replace(/\n$/u, "").split("\n");
  if (lines.length !== 2 || !/^\d+$/u.test(lines[0]!))
    throw new Error("PATH_UNSUPPORTED");
  const row = lines[1]!.split(":");
  if (row.length !== 7 || row[2] !== lines[0] || !row[5])
    throw new Error("PATH_UNSUPPORTED");
  return remotePathSchema.parse(row[5]);
}
export function resolveAccountHome(client: Client): Promise<string> {
  return new Promise((resolve, reject) => {
    let channel: import("ssh2").ClientChannel | null = null,
      done = false,
      bytes = Buffer.alloc(0),
      exit: number | null = null;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        channel?.close();
        reject(error);
      } else {
        try {
          if (exit !== 0) throw new Error("PATH_UNSUPPORTED");
          resolve(parseHome(bytes));
        } catch (e) {
          reject(e);
        }
      }
    };
    const timer = setTimeout(() => finish(new Error("IO_TIMEOUT")), 5000);
    try {
      client.exec(HOME_COMMAND, (error, stream) => {
        if (done) {
          stream?.close();
          return;
        }
        if (error) {
          finish(error);
          return;
        }
        channel = stream;
        stream.on("data", (part: Buffer) => {
          if (done) return;
          if (bytes.length + part.length > 16384) {
            finish(new Error("PATH_UNSUPPORTED"));
            return;
          }
          bytes = Buffer.concat([bytes, part]);
        });
        stream.stderr.on("data", () => finish(new Error("PATH_UNSUPPORTED")));
        stream.on("exit", (code: number) => {
          exit = code;
        });
        stream.on("close", () => finish());
        stream.on("error", finish);
      });
    } catch (error) {
      finish(error as Error);
    }
  });
}
