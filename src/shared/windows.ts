import { z } from 'zod';
export const windowKindSchema = z.enum(['home', 'connections', 'files', 'text', 'image', 'execution', 'terminal', 'tasks', 'settings']);
export type WindowKind = z.infer<typeof windowKindSchema>;
export const boundsSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().min(1).max(10000), height: z.number().finite().min(1).max(10000) }).strict();
export type Bounds = z.infer<typeof boundsSchema>;
export const windowModelSchema = z.object({
  windowId: z.uuid(), kind: windowKindSchema, serverId: z.uuid().nullable(), sessionGeneration: z.int().min(1).nullable(), resourceId: z.string().max(4096).nullable(),
  bounds: boundsSchema, restoreBounds: boundsSchema, mode: z.enum(['normal', 'maximized', 'minimized']), restoreMode: z.enum(['normal', 'maximized']), focused: z.boolean(), lastFocusedSequence: z.int().nonnegative()
}).strict();
export type WindowModel = z.infer<typeof windowModelSchema>;
export const minimumWindow: Record<WindowKind, [number, number]> = { home:[640,360], connections: [640,400], files: [640,360], text: [480,320], image: [480,320], execution: [560,320], terminal: [560,320], tasks: [640,360], settings: [560,360] };

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export function resizeBounds(start: Bounds, edge: ResizeEdge, dx: number, dy: number, kind: WindowKind, area: Bounds): Bounds {
  const [minW, minH] = minimumWindow[kind];
  let left = start.x, right = start.x + start.width, top = start.y, bottom = start.y + start.height;
  if (edge.includes('w')) left = Math.max(area.x, Math.min(right - Math.min(minW, area.width), left + dx));
  if (edge.includes('e')) right = Math.min(area.x + area.width, Math.max(left + Math.min(minW, area.width), right + dx));
  if (edge.includes('n')) top = Math.max(area.y, Math.min(bottom - Math.min(minH, area.height), top + dy));
  if (edge.includes('s')) bottom = Math.min(area.y + area.height, Math.max(top + Math.min(minH, area.height), bottom + dy));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export class WindowManager {
  private windows: WindowModel[] = [];
  private sequence = 0;
  constructor(private area: Bounds, private readonly id: () => string = () => crypto.randomUUID()) {}
  snapshot(): WindowModel[] { return structuredClone(this.windows); }
  restoreSnapshot(rows: WindowModel[]): void { this.windows = rows.map(row => windowModelSchema.parse(row)); this.sequence = Math.max(0, ...rows.map(row => row.lastFocusedSequence)); this.resizeArea(this.area); this.focusLast(); }
  private clamp(kind: WindowKind, value: Bounds): Bounds {
    const [minWidth, minHeight] = minimumWindow[kind];
    const width = Math.min(this.area.width, Math.max(minWidth, value.width)); const height = Math.min(this.area.height, Math.max(minHeight, value.height));
    return { x: Math.min(this.area.x + this.area.width - width, Math.max(this.area.x, value.x)), y: Math.min(this.area.y + this.area.height - height, Math.max(this.area.y, value.y)), width, height };
  }
  open(kind: WindowKind, serverId: string | null = null, generation: number | null = null, resourceId: string | null = null): WindowModel {
    const singleton = ['connections', 'tasks', 'settings'].includes(kind);
    const previous = this.windows.find(row => (singleton && row.kind === kind) || (['text','image'].includes(kind) && row.kind === kind && row.serverId === serverId && row.sessionGeneration === generation && row.resourceId === resourceId));
    if (previous) { this.restore(previous.windowId); return this.snapshot().find(row => row.windowId === previous.windowId)!; }
    if (this.windows.filter(row=>row.kind!=='home').length >= 12 || (kind === 'files' && this.windows.filter(row => row.kind === 'files').length >= 6) || (['text','image'].includes(kind) && this.windows.filter(row => ['text','image'].includes(row.kind)).length >= 4)) throw new Error('WINDOW_LIMIT');
    const width = Math.min(this.area.width, kind === 'files' ? 940 : 720); const height = Math.min(this.area.height, kind === 'files' ? 596 : 440);
    const offset = this.windows.length * 24;
    const bounds = this.clamp(kind, { x: this.area.x + (this.area.width - width)/2 + offset, y: this.area.y + (this.area.height-height)/2 + offset, width, height });
    const window: WindowModel = { windowId: this.id(), kind, serverId, sessionGeneration: generation, resourceId, bounds, restoreBounds: bounds, mode: 'normal', restoreMode: 'normal', focused: true, lastFocusedSequence: ++this.sequence };
    this.windows.forEach(row => { row.focused = false; }); this.windows.push(window); return structuredClone(window);
  }
  focus(id: string): void { const target = this.windows.find(row => row.windowId === id); if (!target || target.mode === 'minimized') return; this.windows.forEach(row => { row.focused = row === target; }); target.lastFocusedSequence = ++this.sequence; }
  moveResize(id: string, bounds: Bounds): void { const target = this.windows.find(row => row.windowId === id); if (target?.mode === 'normal') { target.bounds = this.clamp(target.kind, boundsSchema.parse(bounds)); target.restoreBounds = { ...target.bounds }; } }
  minimize(id: string): void { const target = this.windows.find(row => row.windowId === id); if (!target || target.mode === 'minimized') return; target.restoreMode = target.mode; target.mode = 'minimized'; target.focused = false; this.focusLast(); }
  restore(id: string): void { const target = this.windows.find(row => row.windowId === id); if (!target) return; if (target.mode === 'minimized') { target.mode = target.restoreMode; target.bounds = target.mode === 'maximized' ? { ...this.area } : this.clamp(target.kind, target.restoreBounds); } this.focus(id); }
  toggleMaximize(id: string): void { const target = this.windows.find(row => row.windowId === id); if (!target || target.mode === 'minimized') return; if (target.mode === 'normal') { target.restoreBounds = { ...target.bounds }; target.mode = 'maximized'; target.bounds = { ...this.area }; } else { target.mode = 'normal'; target.bounds = this.clamp(target.kind, target.restoreBounds); } target.restoreMode = target.mode; this.focus(id); }
  close(id: string): void { this.windows = this.windows.filter(row => row.windowId !== id); this.focusLast(); }
  resizeArea(area: Bounds): void { this.area = boundsSchema.parse(area); for (const row of this.windows) { row.restoreBounds = this.clamp(row.kind, row.restoreBounds); row.bounds = row.mode === 'maximized' ? { ...area } : this.clamp(row.kind, row.bounds); } }
  private focusLast(): void { const last = this.windows.filter(row => row.mode !== 'minimized').sort((a,b) => b.lastFocusedSequence-a.lastFocusedSequence)[0]; this.windows.forEach(row => { row.focused = row === last; }); }
}
