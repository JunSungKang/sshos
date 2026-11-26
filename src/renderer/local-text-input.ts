/** Only native OS file gestures give the shell access to a local File. */
export function nativeDropFile(event: DragEvent): File | null {
  const data = event.dataTransfer;
  if (!data?.types.includes("Files")) return null;
  if (!event.isTrusted) throw new Error("운영체제에서 파일을 다시 선택하세요.");
  const items = Array.from(data.items);
  if (
    data.files.length !== 1 ||
    items.length !== 1 ||
    items[0]?.kind !== "file" ||
    data.types.some((type) => type !== "Files")
  )
    throw new Error("일반 텍스트 파일 하나만 놓으세요.");
  const entry = items[0].webkitGetAsEntry();
  if (!entry?.isFile) throw new Error("폴더 또는 읽을 수 없는 항목입니다.");
  return data.files[0]!;
}

export async function readLocalTextFile(
  file: File,
  limit: number,
): Promise<string> {
  const size = file.size;
  const modified = file.lastModified;
  if (!Number.isSafeInteger(size) || size < 0 || size > limit)
    throw new Error("로컬 파일이 입력 크기 한도를 초과합니다.");
  // A bounded slice also handles a provider that returns more than its reported size.
  let bytes: ArrayBuffer;
  try {
    bytes = await file.slice(0, limit + 1).arrayBuffer();
  } catch {
    throw new Error(
      "로컬 파일을 읽을 수 없습니다. 파일 위치와 접근 권한을 확인하세요.",
    );
  }
  if (
    bytes.byteLength !== size ||
    file.size !== size ||
    file.lastModified !== modified
  )
    throw new Error(
      "읽는 동안 로컬 파일이 변경되었습니다. 파일을 다시 선택하세요.",
    );
  let text: string;
  try {
    // The default decoder consumes exactly one leading UTF-8 BOM.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("UTF-8 텍스트 파일을 선택하세요.");
  }
  if (/\0|\r(?!\n)/u.test(text))
    throw new Error("지원하지 않는 제어 문자 또는 줄바꿈입니다.");
  return text.replace(/\r\n/gu, "\n");
}
