import { describe, expect, it } from "vitest";
import {
  nativeDropFile,
  readLocalTextFile,
} from "../../src/renderer/local-text-input";
import { encodeEditedText } from "../../src/shared/viewers/editor";
import {
  visibleFilePaste,
  visiblePaste,
} from "../../src/renderer/terminal-clipboard";

describe("local text file input", () => {
  it("distinguishes literal glyphs and escape text from spaces, tabs, final newlines and Unicode spacing", () => {
    expect(visibleFilePaste(" ␠␉\t␊\n")).toBe(
      "␠\\u{2420}\\u{2409}␉\\u{240a}␊\n",
    );
    expect(visibleFilePaste("␠ ")).not.toBe(visibleFilePaste(" ␠"));
    expect(visibleFilePaste("\\u{2420}")).toBe("\\\\u{2420}");
    expect(visibleFilePaste("\u00a0\u2028한글")).toBe("\\u{a0}\\u{2028}한글");
    expect(visiblePaste("␠ \t")).toBe("␠ ␉");
  });
  const from = (text: string | Uint8Array) => new File([text], "sample.txt");
  it("preserves text, removes one BOM, normalizes CRLF and counts original bytes", async () => {
    await expect(
      readLocalTextFile(from("\ufeff\ufeff한글\r\n\t🙂\n"), 64),
    ).resolves.toBe("\ufeff한글\n\t🙂\n");
    await expect(readLocalTextFile(from("\ufeff"), 3)).resolves.toBe("");
    await expect(readLocalTextFile(from(""), 0)).resolves.toBe("");
    await expect(readLocalTextFile(from("한"), 2)).rejects.toThrow("한도");
    for (const input of [
      from(new Uint8Array([0xff])),
      from("a\0b"),
      from("a\rb"),
    ])
      await expect(readLocalTextFile(input, 16)).rejects.toThrow();
  });
  it("rejects an inconsistent file snapshot and failed local reads", async () => {
    const file = from("1234");
    Object.defineProperty(file, "size", { value: 3 });
    await expect(readLocalTextFile(file, 12)).rejects.toThrow("변경");
    Object.defineProperty(file, "slice", {
      value() {
        throw new Error("sensitive local path");
      },
    });
    await expect(readLocalTextFile(file, 12)).rejects.toThrow("권한");
  });
  it("includes the destination BOM and expanded newlines in its size limit", () => {
    const content = "x".repeat(2 * 1024 * 1024 - 4) + "\n";
    expect(() =>
      encodeEditedText(content, { hasBOM: true, lineEnding: "crlf" }),
    ).toThrow("VIEW_LIMIT");
  });
  it("accepts exactly one real file item from the OS and distinguishes other drags", () => {
    const file = from("one");
    const data = {
      types: ["Files"],
      files: [file],
      items: [{ kind: "file", webkitGetAsEntry: () => ({ isFile: true }) }],
    };
    const event = (input: unknown, trusted = true) =>
      ({ dataTransfer: input, isTrusted: trusted }) as DragEvent;
    expect(nativeDropFile(event(data))).toBe(file);
    expect(nativeDropFile(event({ types: ["text/plain"] }))).toBe(null);
    expect(() => nativeDropFile(event(data, false))).toThrow();
    expect(() =>
      nativeDropFile(event({ ...data, types: ["Files", "text/plain"] })),
    ).toThrow();
    expect(() =>
      nativeDropFile(event({ ...data, files: [file, file] })),
    ).toThrow();
    expect(() =>
      nativeDropFile(
        event({
          ...data,
          items: [
            { kind: "file", webkitGetAsEntry: () => ({ isFile: false }) },
          ],
        }),
      ),
    ).toThrow();
  });
});
