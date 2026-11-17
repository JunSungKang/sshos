import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { closeDiscardedChannel } from "../../src/worker/connections/channel-close";
import type { ClientChannel } from "ssh2";
class ClientStderr extends PassThrough {
  constructor() {
    super({ emitClose: false });
  }
}
class Channel extends PassThrough {
  server = false;
  stdout: unknown = this;
  stdin: unknown = this;
  stderr: PassThrough = new ClientStderr();
  close = vi.fn(() => this);
  constructor() {
    super({ emitClose: false });
  }
}
const close = (channel: Channel) =>
  closeDiscardedChannel(channel as unknown as ClientChannel);
describe("pinned paused ssh2 channel adapter", () => {
  it("disposes buffered streams without synthesizing protocol close or draining data", async () => {
    const channel = new Channel(),
      data = vi.fn(),
      closed = vi.fn();
    channel.on("data", data);
    channel.on("close", closed);
    channel.pause();
    channel.write(Buffer.from("buffered remote output"));
    close(channel);
    await new Promise((done) => setImmediate(done));
    expect(channel.close).toHaveBeenCalledOnce();
    expect(channel.destroyed).toBe(true);
    expect(channel.stderr.destroyed).toBe(true);
    expect(data).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    channel.emit("close");
    expect(closed).toHaveBeenCalledOnce();
  });
  it("does not use Duplex internals when a channel does not match the pinned client shape", () => {
    for (const field of ["server", "stdout", "stdin", "stderr"]) {
      const channel = new Channel();
      if (field === "server") channel.server = true;
      else if (field === "stderr") channel.stderr = new PassThrough();
      else channel[field] = {};
      close(channel);
      expect(channel.close).toHaveBeenCalledOnce();
      expect(channel.destroyed).toBe(false);
      channel.destroy();
      channel.stderr.destroy();
    }
    const ordinary = Object.assign(new PassThrough(), {
      stderr: new PassThrough(),
      server: false,
      stdout: null,
      stdin: null,
      close: vi.fn(),
    });
    closeDiscardedChannel(ordinary as unknown as ClientChannel);
    expect(ordinary.close).toHaveBeenCalledOnce();
    expect(ordinary.destroyed).toBe(false);
    ordinary.destroy();
    ordinary.stderr.destroy();
  });
  it("keeps an unsuccessful close request from forcibly destroying a channel", () => {
    const channel = new Channel();
    channel.close.mockImplementation(() => {
      throw new Error("already closing");
    });
    expect(() => close(channel)).not.toThrow();
    expect(channel.destroyed).toBe(false);
    channel.destroy();
    channel.stderr.destroy();
  });
});
