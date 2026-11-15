import { decodeText, TEXT_LIMIT } from '../shared/viewers/text';
import { parseImageHeader, IMAGE_LIMIT } from '../shared/viewers/image-header';

type Init={type:'init';jobId:string;kind:'text'|'image';size:number};
type Chunk={type:'chunk';jobId:string;sequence:number;bytes:Uint8Array};
type Finish={type:'finish';jobId:string};
type State={jobId:string;kind:'text'|'image';bytes:Uint8Array<ArrayBuffer>|null;offset:number;sequence:number;finishing:boolean};
let state:State|null=null;
function release(bytes:Uint8Array<ArrayBuffer>):void {
  // Electron's pinned Chromium supports ArrayBuffer.transfer. Detach the
  // assembly buffer after Blob/text construction instead of retaining another
  // full compressed-file buffer during decoding.
  const buffer=bytes.buffer as ArrayBuffer & {transfer(newByteLength:number):ArrayBuffer};
  if (typeof buffer.transfer !== 'function') throw new Error('INTERNAL_ERROR');buffer.transfer(0);
}
async function receive(message:Init|Chunk|Finish):Promise<void> {
  if (message.type === 'init') {
    if (state || !['text','image'].includes(message.kind) || typeof message.jobId !== 'string' || message.jobId.length>64 || !Number.isSafeInteger(message.size) || message.size<0) throw new Error('INPUT_INVALID');
    if (message.size>(message.kind === 'text' ? TEXT_LIMIT : IMAGE_LIMIT)) throw new Error('VIEW_LIMIT');
    state={jobId:message.jobId,kind:message.kind,bytes:new Uint8Array(message.size),offset:0,sequence:0,finishing:false};return;
  }
  if (!state || message.jobId !== state.jobId || !state.bytes || state.finishing) throw new Error('INPUT_INVALID');
  if (message.type === 'chunk') {
    if (!(message.bytes instanceof Uint8Array) || message.bytes.byteLength<1 || message.bytes.byteLength>65536 || message.sequence !== state.sequence) throw new Error('INPUT_INVALID');
    if (state.offset+message.bytes.length>state.bytes.length) throw new Error('SOURCE_CHANGED');
    state.bytes.set(message.bytes,state.offset);state.offset+=message.bytes.length;state.sequence++;
    self.postMessage({type:'consumed',jobId:state.jobId,sequence:message.sequence});return;
  }
  if (message.type !== 'finish' || state.offset !== state.bytes.length) throw new Error('SOURCE_CHANGED');state.finishing=true;
  const bytes=state.bytes;state.bytes=null;
  if (state.kind === 'text') {
    const text=decodeText(bytes);release(bytes);self.postMessage({type:'text',jobId:state.jobId,...text},{transfer:[text.lineStarts.buffer as ArrayBuffer]});self.close();return;
  }
  const header=parseImageHeader(bytes);const blob=new Blob([bytes],{type:header.mime});release(bytes);
  const bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});
  if (bitmap.width !== header.width || bitmap.height !== header.height) {bitmap.close();throw new Error('VIEW_FORMAT_UNSUPPORTED');}
  self.postMessage({type:'image',jobId:state.jobId,header,bitmap},{transfer:[bitmap]});self.close();
}
self.onmessage=(event:MessageEvent<Init|Chunk|Finish>) => {
  void receive(event.data).catch(error => {
    const code=error instanceof Error && ['VIEW_LIMIT','VIEW_FORMAT_UNSUPPORTED','SOURCE_CHANGED','INPUT_INVALID','INTERNAL_ERROR'].includes(error.message) ? error.message : 'VIEW_FORMAT_UNSUPPORTED';
    self.postMessage({type:'error',jobId:state?.jobId ?? null,code});state=null;self.close();
  });
};
