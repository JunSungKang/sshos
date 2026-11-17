import { useEffect, useRef, useState } from "react";
import type { FileProperties } from "../../../shared/files";
import { errorCodeOf } from "../../../shared/errors";
import { ErrorPanel } from "../../ErrorPanel";
export function FilePropertiesDialog({
  token,
  close,
}: {
  token: string;
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<FileProperties | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    dialog.current?.showModal();
    void window.sshOS.file.properties(token).then(
      (value) => {
        if (alive) setData(value);
      },
      (failure) => {
        if (alive) setError(errorCodeOf(failure));
      },
    );
    return () => {
      alive = false;
    };
  }, [token]);
  return (
    <dialog
      ref={dialog}
      className="connection-dialog file-properties"
      aria-label="속성 보기"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <h2>속성</h2>
      {error && <ErrorPanel error={error} phase={null} target={null} />}
      <dl>
        {data
          ? Object.entries({
              경로: data.path,
              종류: data.type,
              크기: `${data.size.toLocaleString()} bytes${data.type === "directory" ? " · 폴더 자체 크기" : ""}`,
              "수정 시간": new Date(data.mtime * 1000).toLocaleString(),
              권한: data.mode.toString(8).padStart(4, "0"),
              "소유자 UID": data.uid,
              "그룹 GID": data.gid,
              Inode: data.inode,
              Device: data.device,
              "하드 링크 수": data.links,
              "조회 시간": new Date(data.listedAt).toLocaleString(),
            }).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))
          : !error && <p>속성을 조회하고 있습니다.</p>}
      </dl>
      <button onClick={close}>닫기</button>
    </dialog>
  );
}
