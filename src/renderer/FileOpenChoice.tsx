import { useEffect, useRef } from 'react';
export function FileOpenChoice({name,path,server,openText,download,downloadEnabled,close}:{name:string;path:string;server:string;openText():void;download():void;downloadEnabled:boolean;close():void}) {
  const dialog=useRef<HTMLDialogElement>(null);useEffect(() => {dialog.current?.showModal();},[]);
  return <dialog ref={dialog} className="connection-dialog" aria-label="파일 열기 형식 선택" onCancel={close}><h2>{name}</h2><p>{server}</p><code>{path}</code><p>PNG·JPG/JPEG·WebP 이미지 형식을 확인하지 못했습니다. 최대2MiB의 UTF-8 텍스트로 열 수 있으며, 편집 버튼을 누른 뒤 저장할 수 있습니다.</p><button onClick={openText}>텍스트로 열기</button><button disabled={!downloadEnabled} onClick={download}>다운로드</button><button onClick={close}>취소</button></dialog>;
}
