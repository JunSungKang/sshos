type Consumer = (text: string) => void | Promise<void>;
// Capture before xterm's built-in paste handler, which normalizes line endings.
export function registerTerminalClipboard(
  element: HTMLElement,
  consumer: Consumer,
): () => void {
  const receive = (event: ClipboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    void Promise.resolve(consumer(text)).catch(() => {});
  };
  element.addEventListener("paste", receive, true);
  return () => element.removeEventListener("paste", receive, true);
}
// The caller closes over the original terminal capability before the native read.
export async function requestNativePaste(
  request: () => Promise<string>,
  consumer: Consumer,
): Promise<void> {
  const text = await request();
  await consumer(text);
}
export function visiblePaste(text: string): string {
  return Array.from(text, (char) =>
    char === "\n"
      ? "␊\n"
      : char === "\r"
        ? "␍"
        : char === "\t"
          ? "␉"
          : /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(char)
            ? `\\u{${char.codePointAt(0)!.toString(16)}}`
            : char,
  ).join("");
}
