import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import { executionSpecSchema,type ExecutionSpec } from '../shared/executions';
import { initialStatSchema,type InitialStat } from '../shared/mutations';
import type { ExecutionContext,ExecutionPreview } from '../shared/execution-ui';
import type { FileController } from './files';
import type { ConnectionController } from './connections';
import type { EngineGateway } from './engine-gateway';
type Preview={entryToken:string;cwdToken:string|null;serverId:string;generation:number;sessionToken:string;epoch:string;spec:ExecutionSpec;stat:InitialStat;identity:ReturnType<ConnectionController['sessionIdentity']>;deadline:number;view:ExecutionPreview};
export class ExecutionPreviews {
  private generation=0;
  private readonly previews=new Map<string,Preview>();private readonly posix=new Set<string>();
  constructor(private readonly files:FileController,private readonly connections:ConnectionController,private readonly gateway:EngineGateway,private readonly healthy:()=>void) {}
  invalidate():void {this.generation++;this.previews.clear();}
  private permission(serverId:string,generation:number,sessionToken:string):void {const cap=this.connections.sessionCapability(sessionToken);if(cap.serverId !== serverId || cap.generation !== generation)throw new Error('TOKEN_EXPIRED');const view=this.connections.views().find(row=>row.serverId === serverId && row.generation === generation);if(!view || view.sftp !== 'available')throw new Error('SFTP_UNAVAILABLE');if(view.os !== 'supported' && !(view.os === 'unknown' && view.osConfirmed))throw new Error(view.os === 'unknown' ? 'OS_UNKNOWN':'OS_UNSUPPORTED');}
  context(token:string):ExecutionContext {const entry=this.files.resolveEntry(z.uuid().parse(token));if(entry.type !== 'file')throw new Error('PATH_UNSUPPORTED');const {serverId,generation,sessionToken}=entry.browser;this.permission(serverId,generation,sessionToken);const identity=this.connections.sessionIdentity(serverId,generation);return {name:entry.rawName,serverName:identity.endpointSnapshot.name,endpoint:`${identity.endpointSnapshot.username}@${identity.endpointSnapshot.endpoint}`,hostKeyFingerprint:identity.hostKeyFingerprint,path:posix.join(entry.path,entry.rawName),cwd:entry.path,posixConfirmed:this.posix.has(`${serverId}:${generation}`)};}
  async preview(payload:unknown):Promise<ExecutionPreview> {
    const generationMarker=this.generation;const input=z.object({entryToken:z.uuid(),cwdToken:z.uuid().optional(),mode:z.enum(['direct','sh','bash']),argv:executionSpecSchema.shape.argv,posixCompatible:z.boolean()}).strict().parse(payload);this.healthy();const context=this.context(input.entryToken),entry=this.files.resolveEntry(input.entryToken),{serverId,generation,sessionToken}=entry.browser;const identity=this.connections.sessionIdentity(serverId,generation);let cwd=entry.path;
    if(input.cwdToken){const directory=this.files.resolveDirectory(input.cwdToken);if(directory.browser.serverId !== serverId || directory.browser.generation !== generation)throw new Error('TOKEN_EXPIRED');cwd=directory.path;}
    if(!context.posixConfirmed && !input.posixCompatible)throw new Error('INPUT_INVALID');const spec=executionSpecSchema.parse({path:context.path,cwd,mode:input.mode,argv:input.argv}),stat=initialStatSchema.parse(await this.gateway.request({action:'execution:inspect',serverId,generation,spec}));if(this.generation !== generationMarker)throw new Error('REQUEST_CANCELLED');this.healthy();this.permission(serverId,generation,sessionToken);this.files.resolveEntry(input.entryToken);if(input.cwdToken)this.files.resolveDirectory(input.cwdToken);
    for(const [token,row] of this.previews)if(row.deadline<=performance.now())this.previews.delete(token);if(this.previews.size>=20)throw new Error('REQUEST_BUSY');
    const token=randomUUID(),view:ExecutionPreview={...context,...spec,confirmationToken:token,expiresAt:new Date(Date.now()+60000).toISOString()};this.previews.set(token,{entryToken:input.entryToken,cwdToken:input.cwdToken ?? null,serverId,generation,sessionToken,epoch:this.gateway.epoch,spec,stat,identity,deadline:performance.now()+60000,view});return structuredClone(view);
  }
  consume(token:string):Preview {const row=this.previews.get(z.uuid().parse(token));if(!row || row.deadline<=performance.now() || row.epoch !== this.gateway.epoch)throw new Error('TOKEN_EXPIRED');this.healthy();this.permission(row.serverId,row.generation,row.sessionToken);this.files.resolveEntry(row.entryToken);if(row.cwdToken)this.files.resolveDirectory(row.cwdToken);this.previews.delete(token);for(const key of this.posix)if(key.startsWith(row.serverId+':') && key !== `${row.serverId}:${row.generation}`)this.posix.delete(key);this.posix.add(`${row.serverId}:${row.generation}`);return structuredClone(row);}
  release(token:string):void {this.previews.delete(z.uuid().parse(token));}
}
