import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import { viewerFrameSchema, type ViewerFrame, type ViewerDescriptor } from '../shared/viewers/reader';
import type { WindowModel } from '../shared/windows';
import type { ConnectionController } from './connections';
import type { FileController } from './files';
import type { DesktopController } from './desktop';
import type { EngineGateway } from './engine-gateway';

type Resource={token:string;viewerId:string;serverId:string;generation:number;epoch:string;sessionToken:string;path:string;parent:string;name:string;serverName:string;endpoint:string;kind:'probe'|'text'|'image';windowId:string|null;ownerWindowId:string|null;readGeneration:number;nextSequence:number;pending:boolean;restarting:boolean;readState:ViewerDescriptor['readState'];lastReadAt:string|null;errorCode:string|null;editing?:boolean};
export class ViewerController {
  private readonly resources=new Map<string,Resource>();
  constructor(private readonly files:FileController,private readonly connections:ConnectionController,private readonly desktop:DesktopController,private readonly gateway:EngineGateway) {
    for (const kind of ['text','image'] as const) desktop.registerResourceResolver(kind,token => {
      const resource=this.resource(token);if (resource.kind !== kind) throw new Error('TOKEN_EXPIRED');return {serverId:resource.serverId,generation:resource.generation,resourceId:resource.viewerId};
    });
  }
  private resource(token:string):Resource {const resource=this.resources.get(token);if (!resource) throw new Error('TOKEN_EXPIRED');return resource;}
  windowForToken(token:string){return this.resource(token).windowId;}
  editTarget(token:string,readGeneration:number){const row=this.resource(token);if(row.kind!=='text' || !row.editing || row.readGeneration!==readGeneration || row.readState!=='complete' || !row.windowId)throw new Error('TOKEN_EXPIRED');this.desktop.requireWindow(row.windowId,'text');return row;}
  get editingCount(){return [...this.resources.values()].filter(row=>row.editing).length;}
  isEditingWindow(id:string){return [...this.resources.values()].some(row=>row.windowId===id && row.editing);}
  discardEditing(id:string){this.desktop.requireWindow(id,'text');const row=[...this.resources.values()].find(value=>value.windowId===id);if(!row || row.kind!=='text')throw new Error('TOKEN_EXPIRED');row.editing=false;}
  private selected(entryToken:string,kind:Resource['kind']):Resource {
    const entry=this.files.resolveEntry(entryToken);if (entry.type !== 'file') throw new Error('PATH_UNSUPPORTED');
    const {serverId,generation,sessionToken,windowId}=entry.browser;const identity=this.connections.sessionIdentity(serverId,generation);
    return {token:randomUUID(),viewerId:randomUUID(),serverId,generation,epoch:this.gateway.epoch,sessionToken,path:posix.join(entry.path,entry.rawName),parent:entry.path,name:entry.rawName,serverName:identity.endpointSnapshot.name,endpoint:`${identity.endpointSnapshot.username}@${identity.endpointSnapshot.endpoint}`,kind,windowId:null,ownerWindowId:kind === 'probe' ? windowId : null,readGeneration:1,nextSequence:0,pending:false,restarting:false,readState:'pending',lastReadAt:null,errorCode:null};
  }
  private async start(resource:Resource):Promise<void> {
    await this.gateway.request({action:'viewer:open',serverId:resource.serverId,generation:resource.generation,viewerId:resource.viewerId,readGeneration:resource.readGeneration,path:resource.path,parent:resource.parent,kind:resource.kind});
  }
  private descriptor(resource:Resource):ViewerDescriptor {
    if (resource.kind === 'probe') throw new Error('INPUT_INVALID');
    return {viewerToken:resource.token,viewerId:resource.viewerId,readGeneration:resource.readGeneration,kind:resource.kind,name:resource.name,path:resource.path,serverId:resource.serverId,generation:resource.generation,serverName:resource.serverName,endpoint:resource.endpoint,readState:resource.readState,nextSequence:resource.nextSequence,lastReadAt:resource.lastReadAt,errorCode:resource.errorCode};
  }
  private async stop(resource:Resource):Promise<void> {await this.gateway.request({action:'viewer:cancel',serverId:resource.serverId,generation:resource.generation,viewerId:resource.viewerId,readGeneration:resource.readGeneration}).catch(() => {});}
  private stillCurrent(token:string,resource:Resource,readGeneration:number):boolean {return this.resources.get(token) === resource && resource.readGeneration === readGeneration && resource.readState !== 'interrupted';}
  async closeWindow(id:string):Promise<void> {
    const selected=[...this.resources.values()].filter(row => row.windowId === id || row.ownerWindowId === id);
    for (const row of selected) {this.resources.delete(row.token);await this.stop(row);}
  }
  interruptRenderer():void {
    for (const row of this.resources.values()) {
      row.editing=false;
      if (row.kind === 'probe') this.resources.delete(row.token);
      else if (row.readState === 'pending') {row.readState='interrupted';row.errorCode='REQUEST_CANCELLED';}
      void this.stop(row);
    }
  }
  private async next(token:string,readGeneration:number,sequence:number):Promise<ViewerFrame> {
    const resource=this.resource(token);
    if (resource.epoch !== this.gateway.epoch || resource.readGeneration !== readGeneration) throw new Error('TOKEN_EXPIRED');
    if (resource.readState === 'interrupted' || resource.readState === 'failed') throw new Error(resource.errorCode ?? 'REQUEST_CANCELLED');
    if (resource.pending || resource.restarting) throw new Error('REQUEST_BUSY');
    if (sequence !== resource.nextSequence && sequence !== resource.nextSequence-1) throw new Error('INPUT_INVALID');resource.pending=true;
    try {
      const frame=viewerFrameSchema.parse(await this.gateway.request({action:'viewer:next',serverId:resource.serverId,generation:resource.generation,viewerId:resource.viewerId,readGeneration,sequence}));
      if (!this.stillCurrent(token,resource,readGeneration)) throw new Error('REQUEST_CANCELLED');
      if (frame.viewerId !== resource.viewerId || frame.readGeneration !== readGeneration || frame.sequence !== sequence || (frame.status !== 'waiting' && frame.metadata.path !== resource.path)) throw new Error('INPUT_INVALID');
      if (frame.status !== 'waiting') resource.nextSequence=Math.max(resource.nextSequence,sequence+1);
      if (frame.status === 'end') {resource.readState='complete';resource.lastReadAt=frame.metadata.readAt;}
      return frame;
    } catch (error) {
      if (resource.readGeneration === readGeneration && resource.readState === 'pending') {resource.readState='failed';resource.errorCode=error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message : 'INTERNAL_ERROR';}
      throw error;
    } finally {if (resource.readGeneration === readGeneration) resource.pending=false;}
  }
  async handle(action:string,payload:unknown):Promise<unknown> {
    if(action==='viewer:setEditing'){const input=z.object({token:z.uuid(),readGeneration:z.int().positive(),active:z.boolean()}).strict().parse(payload),row=this.resource(input.token);if(row.kind!=='text' || row.readGeneration!==input.readGeneration || row.readState!=='complete')throw new Error('TOKEN_EXPIRED');if(input.active)this.connections.sessionCapability(row.sessionToken);row.editing=input.active;return;}
    if (action === 'viewer:probe') {
      if ([...this.resources.values()].filter(row => row.kind === 'probe').length>=6) throw new Error('VIEW_LIMIT');
      const resource=this.selected(z.uuid().parse(payload),'probe');this.resources.set(resource.token,resource);
      try {await this.start(resource);return {probeToken:resource.token,viewerId:resource.viewerId,readGeneration:resource.readGeneration};}
      catch (error) {this.resources.delete(resource.token);await this.stop(resource);throw error;}
    }
    if (action === 'viewer:releaseProbe') {const resource=this.resources.get(z.uuid().parse(payload));if (!resource) return;if (resource.kind !== 'probe') throw new Error('INPUT_INVALID');this.resources.delete(resource.token);await this.stop(resource);return;}
    if (action === 'viewer:open') {
      const input=z.object({entryToken:z.uuid(),kind:z.enum(['text','image'])}).strict().parse(payload);const resource=this.selected(input.entryToken,input.kind);
      const old=[...this.resources.values()].find(row => row.kind === resource.kind && row.serverId === resource.serverId && row.generation === resource.generation && row.path === resource.path);
      if (old) return this.desktop.handle('desktop:registerWindow',{kind:old.kind,resourceToken:old.token});
      if ([...this.resources.values()].filter(row => row.kind !== 'probe').length>=4) throw new Error('WINDOW_LIMIT');
      this.resources.set(resource.token,resource);
      try {const window=this.desktop.handle('desktop:registerWindow',{kind:resource.kind,resourceToken:resource.token}) as WindowModel;resource.windowId=window.windowId;await this.start(resource);return window;}
      catch (error) {this.resources.delete(resource.token);if (resource.windowId) this.desktop.handle('desktop:closeWindow',resource.windowId);await this.stop(resource);throw error;}
    }
    if (action === 'viewer:get') {const id=z.uuid().parse(payload);const resource=[...this.resources.values()].find(row => row.windowId === id);if (!resource) throw new Error('TOKEN_EXPIRED');this.desktop.requireWindow(id,resource.kind);return this.descriptor(resource);}
    if (action === 'viewer:next') {const input=z.object({token:z.uuid(),readGeneration:z.int().min(1),sequence:z.int().nonnegative()}).strict().parse(payload);return this.next(input.token,input.readGeneration,input.sequence);}
    if (action === 'viewer:reread') {
      const resource=this.resource(z.uuid().parse(payload));if (resource.kind === 'probe') throw new Error('INPUT_INVALID');
      if(resource.editing)throw new Error('TEXT_UNSAVED');
      const capability=this.connections.sessionCapability(resource.sessionToken);if (capability.serverId !== resource.serverId || capability.generation !== resource.generation || resource.epoch !== this.gateway.epoch) throw new Error('TOKEN_EXPIRED');
      if (resource.restarting) throw new Error('REQUEST_BUSY');resource.restarting=true;resource.readState='interrupted';
      try {await this.stop(resource);if (this.resources.get(resource.token) !== resource) throw new Error('TOKEN_EXPIRED');this.connections.sessionCapability(resource.sessionToken);resource.readGeneration++;resource.nextSequence=0;resource.pending=false;resource.readState='pending';resource.errorCode=null;await this.start(resource);return this.descriptor(resource);}
      catch (error) {resource.readState='failed';resource.errorCode=error instanceof Error && /^[A-Z_]{1,64}$/u.test(error.message) ? error.message : 'INTERNAL_ERROR';throw error;}
      finally {resource.restarting=false;}
    }
    if (action === 'viewer:stopRead') {
      const input=z.object({token:z.uuid(),readGeneration:z.int().min(1)}).strict().parse(payload);const resource=this.resources.get(input.token);if (!resource || resource.readGeneration !== input.readGeneration) return;
      if (resource.kind === 'probe') throw new Error('INPUT_INVALID');if (resource.readState === 'pending') {resource.readState='interrupted';resource.errorCode='REQUEST_CANCELLED';}await this.stop(resource);return;
    }
    throw new Error('INPUT_INVALID');
  }
}
