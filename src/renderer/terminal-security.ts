import type { Terminal, IDisposable } from "@xterm/xterm";
/** All handlers are public parser APIs of the pinned xterm version. */
export function secureTerminal(
  terminal: Terminal,
  onLimit: () => void,
): IDisposable {
  const handlers: IDisposable[] = [];
  for (const osc of [0, 1, 2, 7, 8, 9, 52, 133, 777, 1337])
    handlers.push(terminal.parser.registerOscHandler(osc, () => true));
  handlers.push(
    terminal.parser.registerCsiHandler({ final: "b" }, (params) => {
      const values = params.flatMap((value) =>
        typeof value === "number" ? [value] : value,
      );
      if (values.some((value) => value > 500)) {
        onLimit();
        return true;
      }
      return false;
    }),
  );
  return {
    dispose: () => {
      for (const handler of handlers) handler.dispose();
    },
  };
}
