import { z } from 'zod';
export const licenseEntrySchema=z.object({id:z.string().regex(/^[a-z0-9-]{1,100}$/u),title:z.string().min(1).max(256),license:z.string().min(1).max(128),bytes:z.number().int().positive().max(16*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/u)}).strict();
export type LicenseEntry=z.infer<typeof licenseEntrySchema>;
export type LicensePage={id:string;offset:number;nextOffset:number|null;text:string};
