import { useEffect, useRef } from "react";
export function FileContextMenu({
  x,
  y,
  writable,
  close,
  open,
  remove,
  rename,
  properties,
  copyToServer,
}: {
  x: number;
  y: number;
  writable: boolean;
  close(): void;
  open(): void;
  remove(): void;
  rename(): void;
  properties(): void;
  copyToServer?(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = menu.current!;
    node.style.left = `${Math.max(8, Math.min(x, window.innerWidth - node.offsetWidth - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(y, window.innerHeight - node.offsetHeight - 8))}px`;
    node.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: PointerEvent) => {
      if (!node.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", close);
    };
  }, []);
  const invoke = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <div
      ref={menu}
      role="menu"
      aria-label="파일 작업"
      className="file-context-menu"
      style={{ left: x, top: y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const buttons = [
            ...menu.current!.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            (index + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
              buttons.length
          ]?.focus();
        }
      }}
    >
      <button role="menuitem" onClick={invoke(open)}>
        열기
      </button>
      {copyToServer && (
        <button role="menuitem" onClick={invoke(copyToServer)}>
          다른 서버로 복사
        </button>
      )}
      <button role="menuitem" disabled={!writable} onClick={invoke(remove)}>
        삭제
      </button>
      <button role="menuitem" disabled={!writable} onClick={invoke(rename)}>
        이름 바꾸기
      </button>
      <button role="menuitem" onClick={invoke(properties)}>
        속성 보기
      </button>
    </div>
  );
}
