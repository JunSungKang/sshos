import { describe, expect, it } from "vitest";
import { GUILogBuffer } from "../../src/renderer/features/execution/gui-log-buffer";
describe("plain GUI log rendering", () => {
  it("joins split UTF8 and same-stream line fragments without inventing blank lines or interpreting ANSI/HTML", () => {
    const log = new GUILogBuffer(),
      bytes = new TextEncoder().encode("한글");
    log.append("stdout", bytes.slice(0, 2));
    expect(log.snapshot()).toEqual([]);
    log.append("stdout", bytes.slice(2));
    log.append("stdout", new TextEncoder().encode(" rest\nnext"));
    log.append("stdout", new TextEncoder().encode(" line\n"));
    expect(log.snapshot().map((row) => row.text)).toEqual([
      "한글 rest",
      "next line",
    ]);
    log.append("stderr", new TextEncoder().encode("\x1b[31m <script>\n"));
    expect(log.snapshot().at(-1)?.text).toBe("\\x1b[31m <script>");
  });
  it("bounds characters, lines and a single long line while marking omitted output and closing gaps", () => {
    const log = new GUILogBuffer(20, 3, 10);
    log.append("stdout", new TextEncoder().encode("012345678901234\n"));
    expect(log.snapshot()[0]?.text).toBe("5678901234");
    expect(log.omitted).toBe(true);
    log.append("stdout", new TextEncoder().encode("one\ntwo\nthree\nfour\n"));
    expect(log.snapshot().map((row) => row.text)).toEqual([
      "two",
      "three",
      "four",
    ]);
    log.append("stdout", new TextEncoder().encode("partial"));
    log.gap();
    log.append("stdout", new TextEncoder().encode("after"));
    expect(log.snapshot().at(-1)?.text).toBe("after");
    log.clear();
    expect(log.snapshot()).toEqual([]);
    expect(log.omitted).toBe(false);
  });
});
