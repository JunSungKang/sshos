import { EventEmitter } from "node:events";
import type { Client, ClientChannel } from "ssh2";
import type { CommandAccess } from "../../src/worker/remote-files/metadata/command-runner";
export function commandFixture(
  handler: (
    command: string,
  ) =>
    | {
        bytes?: Buffer;
        code?: number | null;
        stderr?: boolean;
        hang?: boolean;
        error?: boolean;
      }
    | Promise<{
        bytes?: Buffer;
        code?: number | null;
        stderr?: boolean;
        hang?: boolean;
        error?: boolean;
      }>,
) {
  const commands: string[] = [];
  let stopped = false;
  const channels: EventEmitter[] = [];
  const access: CommandAccess = {
    client: {
      exec(
        command: string,
        done: (error: Error | null, stream?: ClientChannel) => void,
      ) {
        commands.push(command);
        const stream = new EventEmitter() as EventEmitter & {
          stderr: EventEmitter;
          close(): void;
        };
        stream.stderr = new EventEmitter();
        let closed = false;
        stream.close = () => {
          if (closed) return;
          closed = true;
          queueMicrotask(() => stream.emit("close"));
        };
        channels.push(stream);
        done(null, stream as unknown as ClientChannel);
        void Promise.resolve(handler(command)).then((result) => {
          if (result.hang) return;
          if (result.error) {
            stream.emit("error", Error("untrusted detail"));
            return;
          }
          if (result.bytes) {
            const cut = Math.floor(result.bytes.length / 2);
            stream.emit("data", result.bytes.subarray(0, cut));
            stream.emit("data", result.bytes.subarray(cut));
          }
          if (result.stderr)
            stream.stderr.emit("data", Buffer.from("untrusted detail"));
          stream.emit("exit", result.code === undefined ? 0 : result.code);
          stream.emit("end");
          stream.close();
        });
      },
    } as unknown as Client,
    check() {
      if (stopped) throw Error("CONNECTION_LOST");
    },
    quarantine() {
      stopped = true;
      for (const c of channels) c.emit("close");
    },
  };
  return {
    access,
    commands,
    channels,
    stop: () => {
      stopped = true;
    },
    get stopped() {
      return stopped;
    },
  };
}
