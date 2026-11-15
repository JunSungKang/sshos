// Structural checks run before createImageBitmap. They do not implement an image
// decompressor or claim that compressed pixel data is valid.
// Primary references: W3C PNG3, ITU-T T.81, CIPA Exif and RFC9649.
export const IMAGE_LIMIT=20*1024*1024;
export type ImageHeader={format:'png'|'jpeg'|'webp';mime:'image/png'|'image/jpeg'|'image/webp';rawWidth:number;rawHeight:number;width:number;height:number;orientation:number};
function invalid():never {throw new Error('VIEW_FORMAT_UNSUPPORTED');}
const within=(length:number,offset:number,count:number):void => {if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(count) || offset<0 || count<0 || offset+count>length) invalid();};
const fourcc=(bytes:Uint8Array,offset:number):string => {within(bytes.length,offset,4);return String.fromCharCode(bytes[offset]!,bytes[offset+1]!,bytes[offset+2]!,bytes[offset+3]!);};
function dimensions(width:number,height:number):void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width<1 || height<1) invalid();
  if (width>16384 || height>16384 || width*height>40000000) throw new Error('VIEW_LIMIT');
}
function header(format:ImageHeader['format'],width:number,height:number,orientation=1):ImageHeader {
  dimensions(width,height);return {format,mime:`image/${format}`,rawWidth:width,rawHeight:height,width:orientation>=5 ? height : width,height:orientation>=5 ? width : height,orientation};
}
export function imageSignature(bytes:Uint8Array):ImageHeader['format']|null {
  if (bytes.length>=8 && [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)) return 'png';
  if (bytes.length>=3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.length>=12 && fourcc(bytes,0) === 'RIFF' && fourcc(bytes,8) === 'WEBP') return 'webp';
  return null;
}
const crcTable=new Uint32Array(256);
for (let i=0;i<256;i++) {let c=i;for (let bit=0;bit<8;bit++) c=c&1 ? 0xedb88320^(c>>>1) : c>>>1;crcTable[i]=c>>>0;}
function crc32(bytes:Uint8Array,start:number,end:number):number {let crc=0xffffffff;for (let i=start;i<end;i++) crc=crcTable[(crc^bytes[i]!)&255]!^(crc>>>8);return (crc^0xffffffff)>>>0;}
function png(bytes:Uint8Array,view:DataView):ImageHeader {
  let p=8;let width=0,height=0,depth=0,color=0;let ihdr=false,idat=false,idatEnded=false,palette=false;
  while (p<bytes.length) {
    within(bytes.length,p,12);const length=view.getUint32(p);const kind=fourcc(bytes,p+4);within(bytes.length,p+8,length+4);const data=p+8;const end=data+length;
    if (!/^[A-Za-z]{4}$/u.test(kind) || kind[2] !== kind[2]?.toUpperCase()) invalid();
    if (!ihdr && kind !== 'IHDR') invalid();
    if (['acTL','fcTL','fdAT','eXIf'].includes(kind)) invalid();
    if (kind === 'IHDR') {
      if (ihdr || length !== 13) invalid();ihdr=true;width=view.getUint32(data);height=view.getUint32(data+4);dimensions(width,height);depth=bytes[data+8]!;color=bytes[data+9]!;
      const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if (!depths[color]?.includes(depth) || bytes[data+10] !== 0 || bytes[data+11] !== 0 || bytes[data+12]!>1) invalid();
    } else if (kind === 'PLTE') {if (palette || idat || length<3 || length>768 || length%3 !== 0 || [0,4].includes(color) || (color === 3 && length/3>2**depth)) invalid();palette=true;}
    else if (kind === 'IDAT') {if (idatEnded || (color === 3 && !palette)) invalid();idat=true;}
    else {if (idat) idatEnded=true;if (kind[0] === kind[0]?.toUpperCase() && kind !== 'IEND') invalid();}
    if (crc32(bytes,p+4,end) !== view.getUint32(end)) invalid();
    p=end+4;
    if (kind === 'IEND') {if (length !== 0 || !idat || p !== bytes.length) invalid();return header('png',width,height);}
  }
  return invalid();
}
function exif(bytes:Uint8Array):number {
  within(bytes.length,0,8);const marker=String.fromCharCode(bytes[0]!,bytes[1]!);if (!['II','MM'].includes(marker)) invalid();const le=marker === 'II';const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=(offset:number) => {within(bytes.length,offset,2);return view.getUint16(offset,le);};const u32=(offset:number) => {within(bytes.length,offset,4);return view.getUint32(offset,le);};
  if (u16(2) !== 42) invalid();const first=u32(4);if (first<8) invalid();let orientation=1;
  const done=new Set<number>();const visiting=new Set<number>();
  const sizes:Record<number,number>={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,13:4,129:1};
  const walk=(offset:number,root:boolean):void => {
    if (visiting.has(offset) || offset<8 || done.size+visiting.size>128) invalid();if (done.has(offset)) return;visiting.add(offset);
    const count=u16(offset);within(bytes.length,offset+2,count*12+4);let orientationSeen=false;let jpegOffset:number|null=null,jpegLength:number|null=null;
    for (let i=0;i<count;i++) {
      const entry=offset+2+i*12;const tag=u16(entry),type=u16(entry+2),amount=u32(entry+4);const unit=sizes[type];if (!unit) invalid();const length=unit*amount;
      const value=length<=4 ? entry+8 : u32(entry+8);within(bytes.length,value,length);if (length>4 && value<8) invalid();
      if (tag === 0x0112) {if (type !== 3 || amount !== 1 || orientationSeen) invalid();orientationSeen=true;const n=u16(value);if (n<1 || n>8) invalid();if (root) orientation=n;}
      if ([0x8769,0x8825,0xa005].includes(tag)) {if (type !== 4 || amount !== 1) invalid();const pointer=u32(value);if (pointer) walk(pointer,false);}
      if ([0x0201,0x0202].includes(tag)) {if (type !== 4 || amount !== 1) invalid();if (tag === 0x0201) jpegOffset=u32(value);else jpegLength=u32(value);}
    }
    if (jpegOffset !== null || jpegLength !== null) {if (jpegOffset === null || jpegLength === null || jpegOffset<8) invalid();within(bytes.length,jpegOffset,jpegLength);}
    const next=u32(offset+2+count*12);if (next) walk(next,false);visiting.delete(offset);done.add(offset);
  };
  walk(first,true);return orientation;
}
function jpeg(bytes:Uint8Array,view:DataView):ImageHeader {
  let p=2,width=0,height=0,orientation=1,frames=0;let entropy=false,sawScan=false,sawExif=false;
  const sof=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  while (p<bytes.length) {
    if (entropy) {while (p<bytes.length && bytes[p] !== 255) p++;}
    if (p>=bytes.length || bytes[p++] !== 255) invalid();while (p<bytes.length && bytes[p] === 255) p++;if (p>=bytes.length) invalid();const marker=bytes[p++]!;
    if (entropy && (marker === 0 || marker>=0xd0 && marker<=0xd7)) continue;
    entropy=false;
    if (marker === 0xd9) {if (frames !== 1 || !sawScan) invalid();return header('jpeg',width,height,orientation);}
    if (marker === 0xd8 || marker === 0 || marker>=0xd0 && marker<=0xd7) invalid();if (marker === 1) continue;
    within(bytes.length,p,2);const length=view.getUint16(p);if (length<2) invalid();within(bytes.length,p,length);const data=p+2,end=p+length;
    if (sof.has(marker)) {
      if (++frames !== 1 || ![0xc0,0xc1,0xc2].includes(marker) || length<11 || bytes[data] !== 8) invalid();const components=bytes[data+5]!;if (components<1 || length !== 8+components*3) invalid();height=view.getUint16(data+1);width=view.getUint16(data+3);dimensions(width,height);
    }
    if (marker === 0xe1 && length>=6 && fourcc(bytes,data) === 'Exif') {if (sawExif || length<16 || bytes[data+4] !== 0 || bytes[data+5] !== 0) invalid();sawExif=true;orientation=exif(bytes.subarray(data+6,end));}
    if (marker === 0xda) {if (frames !== 1 || length<8 || length !== 6+2*bytes[data]!) invalid();sawScan=true;entropy=true;}
    p=end;
  }
  return invalid();
}
function webp(bytes:Uint8Array,view:DataView):ImageHeader {
  if (view.getUint32(4,true)+8 !== bytes.length) invalid();let p=12,width=0,height=0,canvasW=0,canvasH=0,flags=0;let extended=false,frame=false,alpha=false,icc=false,xmp=false;
  const u24=(offset:number) => {within(bytes.length,offset,3);return bytes[offset]!+bytes[offset+1]!*256+bytes[offset+2]!*65536;};
  while (p<bytes.length) {
    within(bytes.length,p,8);const kind=fourcc(bytes,p),length=view.getUint32(p+4,true),data=p+8,end=data+length;within(bytes.length,data,length+(length%2));if (length%2 && bytes[end] !== 0) invalid();
    if (['ANIM','ANMF','EXIF'].includes(kind)) invalid();
    if (kind === 'VP8X') {if (extended || p !== 12 || length !== 10) invalid();extended=true;flags=bytes[data]!;if (flags&0x0a) invalid();canvasW=u24(data+4)+1;canvasH=u24(data+7)+1;dimensions(canvasW,canvasH);}
    else if (kind === 'ICCP') {if (!extended || icc || frame) invalid();icc=true;}
    else if (kind === 'ALPH') {if (!extended || alpha || frame || length<1) invalid();alpha=true;}
    else if (kind === 'VP8 ' || kind === 'VP8L') {
      if (frame || (!extended && p !== 12)) invalid();frame=true;
      if (kind === 'VP8 ') {if (length<10 || bytes[data]!&1 || bytes[data+3] !== 0x9d || bytes[data+4] !== 1 || bytes[data+5] !== 0x2a) invalid();width=view.getUint16(data+6,true)&0x3fff;height=view.getUint16(data+8,true)&0x3fff;}
      else {if (length<5 || alpha || bytes[data] !== 0x2f) invalid();const bits=view.getUint32(data+1,true);if (bits>>>29) invalid();width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
      dimensions(width,height);if (extended && (width !== canvasW || height !== canvasH)) invalid();
    } else if (kind === 'XMP ') {if (!extended || !frame || xmp) invalid();xmp=true;}
    p=end+length%2;
  }
  if (!frame || (extended && (Boolean(flags&0x20) !== icc || Boolean(flags&0x04) !== xmp || alpha && !(flags&0x10)))) invalid();
  return header('webp',width,height);
}
export function parseImageHeader(bytes:Uint8Array):ImageHeader {
  if (bytes.byteLength>IMAGE_LIMIT) throw new Error('VIEW_LIMIT');const format=imageSignature(bytes);if (!format) invalid();const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (format === 'png') return png(bytes,view);if (format === 'jpeg') return jpeg(bytes,view);return webp(bytes,view);
}
