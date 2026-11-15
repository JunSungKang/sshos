import { z } from 'zod';
import { remotePathSchema } from '../files';
export const viewerReadKindSchema=z.enum(['probe','text','image']);
export type ViewerReadKind=z.infer<typeof viewerReadKindSchema>;
export const viewerMetadataSchema=z.object({path:remotePathSchema,size:z.number().int().nonnegative().safe(),mtime:z.number().int().nonnegative().safe(),readAt:z.iso.datetime().nullable()}).strict();
export type ViewerMetadata=z.infer<typeof viewerMetadataSchema>;
const frameIdentity={viewerId:z.uuid(),readGeneration:z.int().min(1),sequence:z.int().nonnegative()};
export const viewerFrameSchema=z.discriminatedUnion('status',[
  z.object({...frameIdentity,status:z.literal('waiting'),phase:z.enum(['queued','reading'])}).strict(),
  z.object({...frameIdentity,status:z.literal('chunk'),bytes:z.instanceof(Uint8Array).refine(value => value.length>=1 && value.length<=65536),metadata:viewerMetadataSchema}).strict(),
  z.object({...frameIdentity,status:z.literal('end'),metadata:viewerMetadataSchema}).strict()
]);
export type ViewerFrame=z.infer<typeof viewerFrameSchema>;
