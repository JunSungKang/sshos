import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodeText, TEXT_LIMIT } from '../../src/shared/viewers/text';
import { imageSignature, parseImageHeader, IMAGE_LIMIT } from '../../src/shared/viewers/image-header';
function crc(bytes:Buffer):number {let value=0xffffffff;for (const byte of bytes) {value^=byte;for (let bit=0;bit<8;bit++) value=value&1 ? (value>>>1)^0xedb88320 : value>>>1;}return (value^0xffffffff)>>>0;}
function pngChunk(kind:string,data:Buffer):Buffer {const name=Buffer.from(kind);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const sum=Buffer.alloc(4);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([size,name,data,sum]);}
function png(width=1,height=1,extra?:string):Buffer {const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),...(extra ? [pngChunk(extra,Buffer.alloc(8))] : []),pngChunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),pngChunk('IEND',Buffer.alloc(0))]);}
function segment(marker:number,data:Buffer):Buffer {const head=Buffer.from([255,marker,0,0]);head.writeUInt16BE(data.length+2,2);return Buffer.concat([head,data]);}
function jpeg(orientation?:number,little=true):Buffer {
  const parts=[Buffer.from([255,216])];
  if (orientation !== undefined) {
    const tiff=Buffer.alloc(26);tiff.write(little ? 'II' : 'MM');const u16=(value:number,offset:number) => little ? tiff.writeUInt16LE(value,offset) : tiff.writeUInt16BE(value,offset);const u32=(value:number,offset:number) => little ? tiff.writeUInt32LE(value,offset) : tiff.writeUInt32BE(value,offset);
    u16(42,2);u32(8,4);u16(1,8);u16(0x112,10);u16(3,12);u32(1,14);u16(orientation,18);parts.push(segment(0xe1,Buffer.concat([Buffer.from('Exif\0\0'),tiff])));
  }
  parts.push(segment(0xc0,Buffer.from([8,0,2,0,3,1,1,0x11,0])),segment(0xda,Buffer.from([1,1,0,0,63,0])),Buffer.from([0x12,255,0,0x34,255,217]));return Buffer.concat(parts);
}
function riffChunk(kind:string,data:Buffer):Buffer {const head=Buffer.alloc(8);head.write(kind);head.writeUInt32LE(data.length,4);return Buffer.concat([head,data,...(data.length%2 ? [Buffer.from([0])] : [])]);}
function webp(width=3,height=2,extra?:string):Buffer {const data=Buffer.alloc(6);data[0]=0x2f;data.writeUInt32LE((width-1)|((height-1)<<14),1);const chunks=Buffer.concat([riffChunk('VP8L',data),...(extra ? [riffChunk(extra,Buffer.alloc(2))] : [])]);const head=Buffer.from('RIFF0000WEBP');head.writeUInt32LE(chunks.length+4,4);return Buffer.concat([head,chunks]);}
describe('strict readonly viewer formats',() => {
  it('decodes one UTF8 BOM, preserves literal HTML/ANSI and indexes CRLF/LF lines',() => {
    const result=decodeText(new TextEncoder().encode('\ufeffone\r\ntwo\n<script>\u001b[31m'));
    expect(result.hasBOM).toBe(true);expect(result.text).toBe('one\ntwo\n<script>\u001b[31m');expect([...result.lineStarts]).toEqual([0,4,8]);
    expect(decodeText(new TextEncoder().encode('\ufeff\ufefftext')).text).toBe('\ufefftext');
  });
  it('rejects malformed UTF8, NUL, long scalar lines and over-limit bytes',() => {
    expect(() => decodeText(Uint8Array.from([0xc0,0xaf]))).toThrow('VIEW_FORMAT_UNSUPPORTED');expect(() => decodeText(Uint8Array.from([97,0,98]))).toThrow('VIEW_FORMAT_UNSUPPORTED');
    expect(() => decodeText(new Uint8Array(TEXT_LIMIT+1))).toThrow('VIEW_LIMIT');expect(() => decodeText(new TextEncoder().encode('😀'.repeat(100001)))).toThrow('VIEW_LIMIT');expect(() => decodeText(new TextEncoder().encode('😀'.repeat(100000)))).not.toThrow();
  });
  it('validates static PNG structure and CRC before decoding, including nonzero buffer offsets',() => {
    const bytes=png();const wrapped=Buffer.concat([Buffer.from('padding'),bytes]);expect(parseImageHeader(wrapped.subarray(7))).toMatchObject({format:'png',width:1,height:1});
    for (const chunk of ['acTL','fcTL','fdAT','eXIf']) expect(() => parseImageHeader(png(1,1,chunk))).toThrow('VIEW_FORMAT_UNSUPPORTED');
    const broken=Buffer.from(bytes);broken[broken.length-1]^=1;expect(() => parseImageHeader(broken)).toThrow('VIEW_FORMAT_UNSUPPORTED');
    expect(() => parseImageHeader(png(10000,5000))).toThrow('VIEW_LIMIT');expect(() => parseImageHeader(png(16385,1))).toThrow('VIEW_LIMIT');
  });
  it('bounds JPEG markers and TIFF offsets and handles both EXIF byte orders and orientations1–8',() => {
    for (const little of [true,false]) for (let orientation=1;orientation<=8;orientation++) expect(parseImageHeader(jpeg(orientation,little))).toMatchObject({format:'jpeg',orientation,width:orientation>=5 ? 2 : 3,height:orientation>=5 ? 3 : 2});
    expect(parseImageHeader(jpeg())).toMatchObject({orientation:1,width:3,height:2});expect(() => parseImageHeader(jpeg(9))).toThrow('VIEW_FORMAT_UNSUPPORTED');
    const broken=jpeg(1);broken.writeUInt32LE(0xfffffff0,16);expect(() => parseImageHeader(broken)).toThrow('VIEW_FORMAT_UNSUPPORTED');
    const cyclic=jpeg(1);cyclic.writeUInt32LE(8,34);expect(() => parseImageHeader(cyclic)).toThrow('VIEW_FORMAT_UNSUPPORTED');
    expect(() => parseImageHeader(jpeg().subarray(0,-2))).toThrow('VIEW_FORMAT_UNSUPPORTED');
  });
  it('validates WebP dimensions and RIFF lengths and rejects animation and EXIF chunks',() => {
    expect(parseImageHeader(webp())).toMatchObject({format:'webp',width:3,height:2});for (const chunk of ['ANIM','ANMF','EXIF']) expect(() => parseImageHeader(webp(3,2,chunk))).toThrow('VIEW_FORMAT_UNSUPPORTED');
    expect(() => parseImageHeader(webp(16384,16384))).toThrow('VIEW_LIMIT');const broken=webp();broken.writeUInt32LE(0xffffffff,16);expect(() => parseImageHeader(broken)).toThrow('VIEW_FORMAT_UNSUPPORTED');
    const x=Buffer.alloc(10);x[0]=2;const ext=Buffer.concat([riffChunk('VP8X',x),riffChunk('VP8L',Buffer.from([0x2f,0,0,0,0]))]);const head=Buffer.from('RIFF0000WEBP');head.writeUInt32LE(ext.length+4,4);expect(() => parseImageHeader(Buffer.concat([head,ext]))).toThrow('VIEW_FORMAT_UNSUPPORTED');
  });
  it('classifies by signature and refuses other formats or excessive compressed bytes',() => {
    expect(imageSignature(Buffer.from('GIF89a'))).toBeNull();expect(() => parseImageHeader(Buffer.from('<svg/>'))).toThrow('VIEW_FORMAT_UNSUPPORTED');expect(() => parseImageHeader(new Uint8Array(IMAGE_LIMIT+1))).toThrow('VIEW_LIMIT');
  });
});
