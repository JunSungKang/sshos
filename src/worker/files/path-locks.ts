export type PathClaim = { path:string; mode:'write'|'keep' };
const contains = (parent:string, child:string) => parent === child || child.startsWith(parent === '/' ? '/' : parent+'/');
export function claimsConflict(a:PathClaim[],b:PathClaim[]):boolean {
  return a.some(x => b.some(y => (x.mode === 'write' && contains(x.path,y.path)) || (y.mode === 'write' && contains(y.path,x.path))));
}
export class PathLocks {
  private readonly owners = new Map<string,{serverId:string;claims:PathClaim[]}>();
  acquire(taskId:string,serverId:string,claims:PathClaim[]):boolean {
    const existing=this.owners.get(taskId);
    if (existing) {if (existing.serverId !== serverId || JSON.stringify(existing.claims) !== JSON.stringify(claims)) throw new Error('INPUT_INVALID');return true;}
    if ([...this.owners.values()].some(value => value.serverId === serverId && claimsConflict(value.claims,claims))) return false;
    this.owners.set(taskId,{serverId,claims:structuredClone(claims)}); return true;
  }
  release(taskId:string):void { this.owners.delete(taskId); }
}
