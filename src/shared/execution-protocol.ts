import { z } from 'zod';
import { executionReceiptSchema } from './executions';
export const executionRuntimeSchema=z.object({receipt:executionReceiptSchema,recordError:z.boolean(),recordPending:z.boolean(),active:z.boolean(),cleanupPending:z.boolean()}).strict();
export const executionOutputSchema=z.object({frames:z.array(z.object({sequence:z.int().positive(),offset:z.int().nonnegative(),stream:z.enum(['stdout','stderr']),bytes:z.instanceof(Uint8Array).refine(value=>value.length<=32768)}).strict()).max(256),nextOffset:z.int().nonnegative(),endOffset:z.int().nonnegative(),omitted:z.boolean(),gap:z.boolean()}).strict().refine(value=>value.frames.reduce((sum,row)=>sum+row.bytes.length,0)<=32768 && value.nextOffset<=value.endOffset);
