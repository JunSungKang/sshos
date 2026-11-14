export const TEXT_LIMIT=2*1024*1024;
export type DecodedText={text:string;lineStarts:Uint32Array;bytes:number;hasBOM:boolean;encoding:'UTF-8'};
export function decodeText(bytes:Uint8Array):DecodedText {
  if (bytes.byteLength>TEXT_LIMIT) throw new Error('VIEW_LIMIT');
  let text:string;
  try {text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);} catch {throw new Error('VIEW_FORMAT_UNSUPPORTED');}
  if (text.includes('\0')) throw new Error('VIEW_FORMAT_UNSUPPORTED');
  const hasBOM=text.startsWith('\ufeff');if (hasBOM) text=text.slice(1);
  text=text.replace(/\r\n/g,'\n');
  let lineLength=0;let lines=1;
  for (const scalar of text) {if (scalar === '\n') {lineLength=0;lines++;}else if (++lineLength>100000) throw new Error('VIEW_LIMIT');}
  const lineStarts=new Uint32Array(lines);let index=1;
  for (let offset=0;offset<text.length;offset++) if (text.charCodeAt(offset) === 10) lineStarts[index++]=offset+1;
  return {text,lineStarts,bytes:bytes.byteLength,hasBOM,encoding:'UTF-8'};
}
