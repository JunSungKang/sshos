import {z} from 'zod';
import {remotePathSchema} from '../files';
import {mutationReceiptSchema,initialStatSchema} from '../mutations';
import {decodeText,TEXT_LIMIT} from './text';
export const textBaselineSchema=z.object({path:remotePathSchema,parent:remotePathSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.int().min(0).max(TEXT_LIMIT),mtime:z.int().nonnegative(),mode:z.int().nonnegative(),uid:z.int().nonnegative(),gid:z.int().nonnegative()}).strict();
export type TextBaseline=z.infer<typeof textBaselineSchema>;
export const editPreparedSchema=z.object({stat:initialStatSchema}).strict();
export const textSaveInputSchema=z.object({token:z.uuid(),readGeneration:z.int().positive(),text:z.string().max(TEXT_LIMIT)}).strict();
export const editResultSchema=z.object({receipt:mutationReceiptSchema,recordError:z.boolean()}).strict();
export function encodeEditedText(value:string,format:{hasBOM:boolean;lineEnding:'lf'|'crlf'|'mixed'}):Uint8Array<ArrayBuffer> {
 if(format.lineEnding==='mixed' || /\r(?!\n)/u.test(value))throw new Error('TEXT_EDIT_UNSUPPORTED');
 if(/[\ud800-\udfff]/u.test(value))throw new Error('VIEW_FORMAT_UNSUPPORTED');
 const normalized=value.replace(/\r\n/g,'\n');
 const bytes=new TextEncoder().encode((format.hasBOM?'\ufeff':'')+(format.lineEnding==='crlf'?normalized.replace(/\n/g,'\r\n'):normalized));
 decodeText(bytes);return bytes;
}
