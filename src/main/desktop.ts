import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { boundsSchema, windowKindSchema, type WindowModel } from '../shared/windows';
import type { ConnectionController } from './connections';

export class DesktopController {
  private readonly windows = new Map<string, WindowModel>();
  private readonly resources=new Map<string,(token:string)=>{serverId:string;generation:number;resourceId:string}>();
  constructor(private readonly connections: ConnectionController) {}
  registerResourceResolver(kind:string,resolve:(token:string)=>{serverId:string;generation:number;resourceId:string}):void {this.resources.set(kind,resolve);}
  requireWindow(id: string, kind: string): WindowModel {
    const window = this.windows.get(id);
    if (!window || window.kind !== kind) throw new Error('TOKEN_EXPIRED');
    return structuredClone(window);
  }
  handle(action: string, payload: unknown): unknown {
    if (action === 'desktop:getWindowSnapshot') { if (payload !== undefined) throw new Error('INPUT_INVALID'); return [...this.windows.values()].map(value => structuredClone(value)); }
    if (action === 'desktop:registerWindow') {
      const input = z.object({ kind: windowKindSchema, resourceToken: z.uuid().optional() }).strict().parse(payload);
      const global = ['connections', 'tasks', 'settings'].includes(input.kind);
      const resolver=this.resources.get(input.kind);
      if (['text','image','execution'].includes(input.kind) && !resolver) throw new Error('INPUT_INVALID');
      const capability:{serverId:string;generation:number;resourceId?:string}|null = global ? null : input.resourceToken ? resolver ? resolver(input.resourceToken) : this.connections.sessionCapability(input.resourceToken) : null;
      if (!global && !capability) throw new Error('SESSION_UNAVAILABLE');
      const resourceId=capability?.resourceId ?? null;
      const existing = [...this.windows.values()].find(row => row.kind === input.kind && (global || resourceId !== null && row.resourceId === resourceId && row.serverId === capability?.serverId && row.sessionGeneration === capability?.generation));
      if (existing) return structuredClone(existing);
      if (this.windows.size >= 12) throw new Error('WINDOW_LIMIT');
      if (input.kind === 'files' && [...this.windows.values()].filter(row => row.kind === 'files').length >= 6) throw new Error('WINDOW_LIMIT');
      if (['text','image'].includes(input.kind) && [...this.windows.values()].filter(row => ['text','image'].includes(row.kind)).length >= 4) throw new Error('WINDOW_LIMIT');
      const bounds = { x: 0, y: 44, width: 720, height: 440 };
      const model: WindowModel = { windowId: randomUUID(), kind: input.kind, serverId: capability?.serverId ?? null, sessionGeneration: capability?.generation ?? null, resourceId: global ? null : resourceId ?? randomUUID(), bounds, restoreBounds: bounds, mode: 'normal', restoreMode: 'normal', focused: false, lastFocusedSequence: 0 };
      this.windows.set(model.windowId, model); return structuredClone(model);
    }
    if (action === 'desktop:updateWindowLayout') {
      const input = z.object({ windowId: z.uuid(), bounds: boundsSchema, restoreBounds: boundsSchema, mode: z.enum(['normal','maximized','minimized']), restoreMode: z.enum(['normal','maximized']), focused: z.boolean(), lastFocusedSequence: z.int().nonnegative() }).strict().parse(payload);
      const model = this.windows.get(input.windowId); if (!model) throw new Error('INPUT_INVALID');
      Object.assign(model, input); return;
    }
    if (action === 'desktop:closeWindow') { this.windows.delete(z.uuid().parse(payload)); return; }
    throw new Error('INPUT_INVALID');
  }
}
