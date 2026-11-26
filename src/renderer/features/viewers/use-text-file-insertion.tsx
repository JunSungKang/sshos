import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from "react";
import { encodeEditedText } from "../../../shared/viewers/editor";
import { TEXT_LIMIT, type DecodedText } from "../../../shared/viewers/text";
import { nativeDropFile, readLocalTextFile } from "../../local-text-input";
import {
  TextDropPositionProbe,
  type TextDropPosition,
} from "./text-drop-position";

type Input = {
  viewport: RefObject<HTMLDivElement | null>;
  editor: RefObject<HTMLTextAreaElement | null>;
  token: string | undefined;
  generation: number | undefined;
  text: DecodedText | null;
  draft: string;
  editing: boolean;
  available: boolean;
  beginEdit(): Promise<boolean>;
  notice(message: string): void;
};
type Target = {
  serial: number;
  token: string;
  generation: number;
  offset: number;
  original: string;
  editing: boolean;
};
type Pending = { target: Target; content: string };

export function useTextFileInsertion(input: Input) {
  const latest = useRef(input);
  latest.current = input;
  const serial = useRef(0),
    composing = useRef(false);
  const probe = useRef(new TextDropPositionProbe());
  const picker = useRef<HTMLInputElement>(null),
    pickerTarget = useRef<Target | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [marker, setMarker] = useState<TextDropPosition | null>(null);
  const resetPosition = () => {
    probe.current.close();
    setMarker(null);
  };
  const invalidate = () => {
    serial.current++;
    pickerTarget.current = null;
    setPending(null);
  };
  useEffect(() => {
    if (pending) dialog.current?.showModal();
  }, [pending]);
  useEffect(
    () => () => {
      serial.current++;
      probe.current.close();
    },
    [],
  );

  const capture = (offset: number): Target | null => {
    invalidate();
    const v = latest.current;
    if (
      !v.available ||
      !v.text ||
      !v.token ||
      !v.generation ||
      composing.current
    ) {
      v.notice("편집 가능한 문서에서 문자 입력을 마친 뒤 다시 선택하세요.");
      return null;
    }
    return {
      serial: serial.current,
      token: v.token,
      generation: v.generation,
      offset,
      original: v.editing ? v.draft : v.text.text,
      editing: v.editing,
    };
  };
  const current = (target: Target, editing: boolean) => {
    const v = latest.current;
    const viewport = v.viewport.current;
    return (
      serial.current === target.serial &&
      !composing.current &&
      v.available &&
      v.token === target.token &&
      v.generation === target.generation &&
      v.editing === editing &&
      viewport?.isConnected &&
      !viewport.closest("[inert], [hidden], [aria-hidden=true]") &&
      viewport.checkVisibility({ visibilityProperty: true }) &&
      !Array.from(document.querySelectorAll("dialog:modal")).some(
        (modal) => modal !== dialog.current && !modal.contains(viewport),
      ) &&
      (editing ? v.draft : v.text?.text) === target.original
    );
  };
  const stale = () =>
    latest.current.notice(
      "입력 대상이 바뀌었습니다. 삽입할 위치에서 다시 선택하세요.",
    );
  const insert = ({ target, content }: Pending) => {
    const area = latest.current.editor.current;
    if (
      !current(target, true) ||
      !area ||
      area.readOnly ||
      area.value !== target.original
    ) {
      stale();
      return;
    }
    // End the preceding typing transaction; Chromium's editor supplies native undo/redo.
    area.blur();
    area.focus({ preventScroll: true });
    // insertText operates on the document's focused editor. Inert/covered inputs can refuse focus.
    if (document.activeElement !== area || !current(target, true)) {
      stale();
      return;
    }
    area.setSelectionRange(target.offset, target.offset);
    if (!document.execCommand("insertText", false, content))
      latest.current.notice(
        "텍스트를 삽입하지 못했습니다. 위치를 확인한 뒤 다시 선택하세요.",
      );
  };
  const prepare = async (file: File, target: Target) => {
    try {
      const content = await readLocalTextFile(file, TEXT_LIMIT);
      if (!current(target, target.editing)) {
        if (latest.current.viewport.current) stale();
        return;
      }
      if (!content) {
        latest.current.notice("빈 텍스트 파일입니다.");
        return;
      }
      const result =
        target.original.slice(0, target.offset) +
        content +
        target.original.slice(target.offset);
      try {
        encodeEditedText(result, latest.current.text!);
      } catch {
        latest.current.notice(
          "삽입 후 문서가 지원하는 UTF-8 크기 또는 줄 길이 한도를 초과합니다.",
        );
        return;
      }
      if (target.editing) insert({ target, content });
      else setPending({ target, content });
    } catch (failure) {
      if (serial.current === target.serial)
        latest.current.notice(
          failure instanceof Error
            ? failure.message
            : "로컬 파일을 읽을 수 없습니다.",
        );
    }
  };
  const accept = async () => {
    if (!pending) return;
    const accepted = pending;
    setPending(null);
    if (!current(accepted.target, false)) {
      stale();
      return;
    }
    if (await latest.current.beginEdit()) insert(accepted);
  };
  const position = (e: DragEvent) =>
    input.viewport.current &&
    probe.current.locate(input.viewport.current, e.clientX, e.clientY);
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    const next = input.available && !composing.current ? position(e) : null;
    e.dataTransfer.dropEffect = next ? "copy" : "none";
    setMarker(next);
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.stopPropagation();
    e.preventDefault();
    const at = position(e);
    resetPosition();
    invalidate();
    try {
      const file = nativeDropFile(e.nativeEvent);
      if (!file) return;
      if (!at) {
        input.notice(
          "삽입할 글자 위치에 놓거나 편집기에서 커서를 놓고 파일을 선택하세요.",
        );
        return;
      }
      const target = capture(at.offset);
      if (target) void prepare(file, target);
    } catch (e) {
      input.notice(
        e instanceof Error ? e.message : "파일을 확인할 수 없습니다.",
      );
    }
  };
  const choose = () => {
    const offset = input.editing
      ? (input.editor.current?.selectionStart ?? 0)
      : 0;
    pickerTarget.current = capture(offset);
    if (pickerTarget.current) picker.current?.click();
  };
  return {
    invalidate,
    onDrop,
    onDragOver,
    resetPosition,
    marker,
    choose,
    startComposition() {
      composing.current = true;
      invalidate();
    },
    endComposition() {
      composing.current = false;
    },
    controls: (
      <>
        <input
          type="file"
          hidden
          ref={picker}
          aria-label="삽입할 로컬 텍스트 파일"
          onChange={(e) => {
            const file =
              e.nativeEvent.isTrusted && e.currentTarget.files?.length === 1
                ? e.currentTarget.files[0]
                : null;
            const target = pickerTarget.current;
            pickerTarget.current = null;
            e.currentTarget.value = "";
            if (file && target) void prepare(file, target);
          }}
        />
        {pending && (
          <dialog
            ref={dialog}
            className="connection-dialog"
            aria-label="파일 내용 삽입 확인"
            onCancel={invalidate}
          >
            <h2>편집 모드로 전환해 여기에 삽입할까요?</h2>
            <p>
              파일 내용은 문서 초안에 들어갑니다. 저장을 누르면 원격 파일에
              반영됩니다.
            </p>
            <button autoFocus onClick={invalidate}>
              취소
            </button>
            <button onClick={() => void accept()}>
              편집 모드로 전환해 여기에 삽입
            </button>
          </dialog>
        )}
      </>
    ),
  };
}
