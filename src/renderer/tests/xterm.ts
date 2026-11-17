import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { secureTerminal } from "../terminal-security";
import { registerTerminalClipboard } from "../terminal-clipboard";
import "@xterm/xterm/css/xterm.css";
const element = document.getElementById("terminal");
if (!element) throw new Error("Fixture container absent");
const terminal = new Terminal({ allowProposedApi: false }),
  fit = new FitAddon();
terminal.loadAddon(fit);
terminal.open(element);
fit.fit();
let evalBlocked = false;
try {
  Function("return 1")();
} catch {
  evalBlocked = true;
}
let titles = 0,
  limits = 0,
  pasteText = "",
  input = "";
terminal.onTitleChange(() => titles++);
terminal.onData((text) => {
  input += text;
});
secureTerminal(terminal, () => limits++);
const stopPaste = registerTerminalClipboard(element, (text) => {
  pasteText = text;
});
const write = (text: string) =>
  new Promise<void>((done) => terminal.write(text, done));
async function verify(): Promise<void> {
  await write(
    "시오스 터미널 렌더링 검사\r\n\x1b]0;untrusted-title\x07\x1b]2;other-title\x07\x1b]8;;https://example.invalid\x07plain-link\x1b]8;;\x07\x1b]52;c;c2VjcmV0\x07\r\nZ\x1b[2147483647b",
  );
  if (titles !== 0 || limits !== 1 || element!.querySelector("a"))
    throw new Error("Terminal parser boundary failed");
  terminal.reset();
  await write("Z\x1b[500b");
  let cells = "";
  for (let index = 0; index < terminal.buffer.active.length; index++)
    cells +=
      terminal.buffer.active.getLine(index)?.translateToString(true) ?? "";
  if (cells.replace(/[^Z]/gu, "").length !== 501 || limits !== 1)
    throw new Error("REP500 public parser behavior differs");
  terminal.reset();
  await write("\x1b]52;c;" + "A".repeat(1024 ** 2) + "\x1b\\");
  await write("\x1bP9999;" + "B".repeat(1024 ** 2) + "\x1b\\");
  await write(
    "e" +
      "\u0301".repeat(32768) +
      "\r\nUTF8 한글 😀\x1b[999999999999999999999999999999999b",
  );
  if (titles !== 0 || Number(limits) !== 2 || element!.querySelector("a"))
    throw new Error(
      "Long OSC/DCS/combining or numeric flood escaped parser boundary",
    );
  terminal.reset();
  const clipboard = new DataTransfer();
  clipboard.setData("text/plain", "line-one\r\nline-two\n");
  element!.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData: clipboard,
      bubbles: true,
      cancelable: true,
    }),
  );
  if (pasteText !== "line-one\r\nline-two\n" || input !== "")
    throw new Error("Paste capture changed bytes or reached xterm");
  stopPaste();
  const ready = document.createElement("output");
  ready.dataset["testid"] = "xterm-ready";
  ready.dataset["evalBlocked"] = String(evalBlocked);
  ready.dataset["security"] = "osc-rep-paste-pass";
  ready.textContent = `${terminal.cols}×${terminal.rows}`;
  document.body.append(ready);
}
void verify().catch((error) => {
  document.body.dataset["fixtureError"] = String(error);
  throw error;
});
