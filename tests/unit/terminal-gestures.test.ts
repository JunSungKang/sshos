import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { clipboard } from "electron";
import type { BrowserWindow } from "electron";
vi.mock("electron", () => ({
  clipboard: {
    readText: () => {
      throw new Error("Unexpected clipboard read");
    },
  },
}));
import { TerminalPasteGesture } from "../../src/main/terminal/terminal-gestures";
afterEach(() => vi.restoreAllMocks());
describe("native terminal paste gesture gate", () => {
  it("requires recent native paste/left-click input from the same focused window and consumes it once", async () => {
    let now = 0,
      focused = true;
    const read = vi.fn(() => "fixture"),
      window = {
        isDestroyed: () => false,
        isMinimized: () => false,
        webContents: { on: vi.fn(), isFocused: () => focused },
      } as unknown as BrowserWindow,
      gate = new TerminalPasteGesture(() => now, read);
    gate.bind(window);
    await expect(gate.readPaste(window)).rejects.toThrow("INPUT_INVALID");
    gate.mouse({ type: "mouseDown", button: "left" });
    expect(await gate.readPaste(window)).toBe("fixture");
    expect(read).toHaveBeenCalledOnce();
    await expect(gate.readPaste(window)).rejects.toThrow("INPUT_INVALID");
    gate.key({
      type: "keyDown",
      key: "v",
      meta: true,
      control: false,
      shift: false,
    });
    focused = false;
    await expect(gate.readPaste(window)).rejects.toThrow("INPUT_INVALID");
    focused = true;
    now = 1001;
    await expect(gate.readPaste(window)).rejects.toThrow("INPUT_INVALID");
    gate.key({
      type: "keyDown",
      key: "v",
      meta: false,
      control: true,
      shift: true,
    });
    await expect(gate.readPaste({} as BrowserWindow)).rejects.toThrow(
      "INPUT_INVALID",
    );
    expect(await gate.readPaste(window)).toBe("fixture");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not grant paste for arbitrary key events, right clicks or reloads, and drops a late clipboard result", async () => {
    let resolve!: (text: string) => void;
    const read = vi.fn(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      ),
      window = {
        isDestroyed: () => false,
        isMinimized: () => false,
        webContents: { on: vi.fn(), isFocused: () => true },
      } as unknown as BrowserWindow,
      gate = new TerminalPasteGesture(() => 0, read);
    gate.bind(window);
    gate.key({
      type: "keyDown",
      key: "c",
      meta: true,
      control: false,
      shift: false,
    });
    gate.mouse({ type: "mouseDown", button: "right" });
    await expect(gate.readPaste(window)).rejects.toThrow("INPUT_INVALID");
    gate.mouse({ type: "mouseDown", button: "left" });
    const pending = gate.readPaste(window);
    gate.invalidate();
    resolve("private fixture");
    await expect(pending).rejects.toThrow("REQUEST_CANCELLED");
    await expect(gate.readPaste(window)).rejects.toThrow("INPUT_INVALID");
  });
});

it("binds native event listeners only to the current owner and checks minimized/destroyed/overlimit results", async () => {
  const make = () => ({
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      webContents: Object.assign(new EventEmitter(), { isFocused: () => true }),
    }),
    first = make(),
    second = make(),
    gate = new TerminalPasteGesture(
      () => 0,
      async () => "한".repeat(21846),
    );
  gate.bind(first as never);
  gate.bind(second as never);
  first.webContents.emit(
    "before-input-event",
    {},
    { type: "keyDown", key: "v", meta: true, control: false, shift: false },
  );
  await expect(gate.readPaste(second as never)).rejects.toThrow(
    "INPUT_INVALID",
  );
  second.webContents.emit(
    "before-mouse-event",
    {},
    { type: "mouseDown", button: "left" },
  );
  second.isMinimized.mockReturnValue(true);
  await expect(gate.readPaste(second as never)).rejects.toThrow(
    "INPUT_INVALID",
  );
  second.isMinimized.mockReturnValue(false);
  second.isDestroyed.mockReturnValue(true);
  await expect(gate.readPaste(second as never)).rejects.toThrow(
    "INPUT_INVALID",
  );
  second.isDestroyed.mockReturnValue(false);
  await expect(gate.readPaste(second as never)).rejects.toThrow("INPUT_LIMIT");
  await expect(gate.readPaste(second as never)).rejects.toThrow(
    "INPUT_INVALID",
  );
  second.webContents.emit(
    "before-input-event",
    {},
    { type: "keyUp", key: "v", meta: true, control: false, shift: false },
  );
  await expect(gate.readPaste(second as never)).rejects.toThrow(
    "INPUT_INVALID",
  );
});

it("awaits the pinned Electron asynchronous clipboard API and rejects a destroyed owner after the read", async () => {
  const window = {
    isDestroyed: vi.fn(() => false),
    isMinimized: () => false,
    webContents: { on: vi.fn(), isFocused: () => true },
  } as unknown as BrowserWindow;
  vi.spyOn(clipboard, "readText").mockResolvedValue("native fixture");
  const gate = new TerminalPasteGesture();
  gate.bind(window);
  gate.mouse({ type: "mouseDown", button: "left" });
  expect(await gate.readPaste(window)).toBe("native fixture");
  let finish!: (value: string) => void;
  const pendingGate = new TerminalPasteGesture(
    () => 0,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  pendingGate.bind(window);
  pendingGate.mouse({ type: "mouseDown", button: "left" });
  const pending = pendingGate.readPaste(window),
    rejected = expect(pending).rejects.toThrow("REQUEST_CANCELLED");
  vi.mocked(window.isDestroyed).mockReturnValue(true);
  finish("private");
  await rejected;
});
