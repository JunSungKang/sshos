import { useEffect, useRef } from "react";
import type { WindowModel } from "../../../shared/windows";
export function WindowList({
  rows,
  title,
  select,
  closeWindow,
  dismiss,
}: {
  rows: WindowModel[];
  title(row: WindowModel): string;
  select(id: string): void;
  closeWindow(row: WindowModel): void;
  dismiss(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="window-list-dialog"
      aria-label="열린 창 목록"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <h2>창 한도에 도달했습니다</h2>
      <p>
        전체12개 · 파일6개 · 뷰어4개 한도입니다. 열린 창을 선택하거나 사용하지
        않는 창을 닫은 뒤 새 작업을 다시 요청하세요.
      </p>
      <ul>
        {rows.map((row) => (
          <li key={row.windowId}>
            <span>
              {title(row)}
              {row.mode === "minimized" ? " · 최소화됨" : ""}
            </span>
            <button onClick={() => select(row.windowId)}>창으로 이동</button>
            <button onClick={() => closeWindow(row)}>이 창 닫기</button>
          </li>
        ))}
      </ul>
      <button onClick={dismiss}>목록 닫기</button>
    </dialog>
  );
}
