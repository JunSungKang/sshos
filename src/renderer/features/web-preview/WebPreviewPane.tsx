import { useEffect, useRef, useState } from "react";
import type { WebPreviewDescriptor } from "../../../shared/web-preview";
import { errorCodeOf } from "../../../shared/errors";
export function WebPreviewPane({
  windowId,
  visible,
}: {
  windowId: string;
  visible: boolean;
}) {
  const [value, setValue] = useState<WebPreviewDescriptor | null>(null),
    [root, setRoot] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const area = useRef<HTMLDivElement>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void window.sshOS.web.get(windowId).then(
      (v) => {
        if (alive.current) {
          setValue(v);
          setRoot(v.root);
        }
      },
      (e) => {
        if (alive.current) setError(errorCodeOf(e));
      },
    );
    return () => {
      alive.current = false;
    };
  }, [windowId]);
  useEffect(() => {
    let stopped = false,
      pending: ReturnType<typeof setTimeout> | null = null,
      last = "";
    const update = () => {
      pending = null;
      if (stopped) return;
      const rect = area.current?.getBoundingClientRect();
      if (!rect) return;
      const show =
        visible && !document.querySelector('dialog[open], [role="menu"]');
      const next = {
        id: windowId,
        visible: Boolean(show),
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      };
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        void window.sshOS.web.present(next).catch(() => {
          last = "";
        });
      }
    };
    const schedule = () => {
      if (!pending && !stopped) pending = setTimeout(update, 50);
    };
    const resized = new ResizeObserver(schedule);
    if (area.current) resized.observe(area.current);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "open", "hidden"],
      childList: true,
    });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      stopped = true;
      if (pending) clearTimeout(pending);
      resized.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      void window.sshOS.web
        .present({
          id: windowId,
          visible: false,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        })
        .catch(() => {});
    };
  }, [windowId, visible, value]);
  const reload = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setValue(await window.sshOS.web.reload(windowId));
    } catch (e) {
      setError(errorCodeOf(e));
    } finally {
      setBusy(false);
    }
  };
  const change = async (js: boolean) => {
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      setValue(
        await window.sshOS.web.configure({
          id: windowId,
          root,
          javascript: js,
        }),
      );
    } catch (e) {
      setError(errorCodeOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="web-preview-pane">
      <div className="web-preview-controls">
        <strong>{value?.name ?? "HTML 미리보기"}</strong>
        <button disabled={!value || busy} onClick={() => void reload()}>
          새로고침
        </button>
        <label>
          리소스 루트{" "}
          <input
            aria-label="웹 리소스 루트"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
          />
        </label>
        <button
          disabled={!value || busy}
          onClick={() => void change(value!.javascript)}
        >
          루트 적용
        </button>
        <label>
          <input
            type="checkbox"
            checked={value?.javascript ?? false}
            disabled={!value || busy}
            onChange={(e) => void change(e.target.checked)}
          />
          이 창에서 JavaScript 허용
        </label>
      </div>
      <p className="web-preview-note">
        SSH 파일 미리보기 · 외부 네트워크 차단 · 서버에서 실행되는 코드는
        처리하지 않습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="web-preview-content" ref={area}>
        <p className="web-preview-placeholder">
          표시되지 않으면 새로고침하여 미리보기를 다시 여세요.
        </p>
      </div>
    </section>
  );
}
