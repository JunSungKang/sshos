import { z } from 'zod';

export const remotePathSchema = z.string().refine(value => value.startsWith('/') && new TextEncoder().encode(value).length <= 4096 && !value.includes('\0') && (value === '/' || value.split('/').slice(1).every(part => validName(part))));
export function validName(value: string): boolean {
  const size = new TextEncoder().encode(value).length;
  return size >= 1 && size <= 255 && value !== '.' && value !== '..' && !/[\/\u0000-\u001f\u007f\ufffd\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(value);
}
export function displayName(value: string): string {
  return Array.from(value).slice(0, 256).map(char => /[\u0000-\u001f\u007f\ufffd\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(char) ? `\\u{${char.codePointAt(0)!.toString(16)}}` : char).join('') + (Array.from(value).length > 256 ? '…' : '');
}
export function compareNames(a: string, b: string): number {
  const x = Array.from(a, c => c.codePointAt(0)!); const y = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}
export const fileTypeSchema = z.enum(['file','directory','symlink','special','unknown']);
export const fileEntrySchema = z.object({ rawName: z.string().max(4096), name: z.string().max(4096), type: fileTypeSchema, operable: z.boolean(), size: z.number().int().nonnegative().safe().nullable(), mtime: z.number().int().nonnegative().safe().nullable(), mode: z.number().int().nonnegative().max(0xffffffff).nullable() }).strict();
export type FileEntry = z.infer<typeof fileEntrySchema>;
export const filePageSchema = z.object({ snapshotId: z.uuid(), path: remotePathSchema, listedAt: z.iso.datetime(), partial: z.boolean(), total: z.int().min(0).max(10000), offset: z.int().min(0).max(10000), nextOffset: z.int().min(0).max(10000).nullable(), entries: fileEntrySchema.array().max(256) }).strict();
export type FilePage = z.infer<typeof filePageSchema>;
export type EntryView = Omit<FileEntry, 'rawName'> & { entryToken: string | null; directoryToken: string | null };
export type DirectoryPage = Omit<FilePage, 'entries' | 'snapshotId'> & { directoryToken: string; parentToken: string | null; pageToken: string; entries: EntryView[] };

