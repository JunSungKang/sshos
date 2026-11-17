import { z } from "zod";
import { remotePathSchema } from "./files";
export const webPreviewDescriptorSchema = z
  .object({
    windowId: z.uuid(),
    name: z.string().max(255),
    root: remotePathSchema,
    javascript: z.boolean(),
  })
  .strict();
export type WebPreviewDescriptor = z.infer<typeof webPreviewDescriptorSchema>;
export const webPresentationSchema = z
  .object({
    id: z.uuid(),
    visible: z.boolean(),
    x: z.number().int().min(0).max(10000),
    y: z.number().int().min(0).max(10000),
    width: z.number().int().min(0).max(10000),
    height: z.number().int().min(0).max(10000),
  })
  .strict();
