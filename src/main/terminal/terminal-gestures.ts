import {
  clipboard,
  type BrowserWindow,
  type Input,
  type MouseInputEvent,
} from "electron";
/** Native input only; remote terminal output cannot manufacture this gesture. */
export class TerminalPasteGesture {
  private at = Number.NEGATIVE_INFINITY;
  private used = true;
  private owner: BrowserWindow | null = null;
  private generation = 0;
  constructor(
    private readonly clock: () => number = () => performance.now(),
    private readonly read: () => string | Promise<string> = () =>
      clipboard.readText(),
  ) {}
  bind(window: BrowserWindow): void {
    this.owner = window;
    this.invalidate();
    window.webContents.on("before-input-event", (_event, input) => {
      if (this.owner === window) this.key(input);
    });
    window.webContents.on("before-mouse-event", (_event, input) => {
      if (this.owner === window) this.mouse(input);
    });
  }
  key(input: Pick<Input, "type" | "key" | "meta" | "control" | "shift">): void {
    if (
      input.type === "keyDown" &&
      input.key.toLowerCase() === "v" &&
      (input.meta || (input.control && input.shift))
    ) {
      this.at = this.clock();
      this.used = false;
    }
  }
  mouse(input: Pick<MouseInputEvent, "type" | "button">): void {
    if (input.type === "mouseDown" && input.button === "left") {
      this.at = this.clock();
      this.used = false;
    }
  }
  invalidate(): void {
    this.generation++;
    this.at = Number.NEGATIVE_INFINITY;
    this.used = true;
  }
  async readPaste(window: BrowserWindow): Promise<string> {
    if (
      this.owner !== window ||
      window.isDestroyed() ||
      window.isMinimized() ||
      !window.webContents.isFocused() ||
      this.used ||
      this.clock() - this.at > 1000
    )
      throw new Error("INPUT_INVALID");
    this.used = true;
    const generation = this.generation,
      text = await this.read();
    if (
      this.owner !== window ||
      window.isDestroyed() ||
      generation !== this.generation
    )
      throw new Error("REQUEST_CANCELLED");
    if (Buffer.byteLength(text, "utf8") > 65536) throw new Error("INPUT_LIMIT");
    return text;
  }
}
