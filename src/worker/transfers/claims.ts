import type { TransferReceipt } from '../../shared/transfers';
import type { PathClaim } from '../files/path-locks';
// Conservative alias folding is for locks only, never for filesystem requests.
export function localPathLockKey(path:string):string {const value=path.replace(/\\/gu,'/').normalize('NFD').toLowerCase();return value.startsWith('/') ? value : '/'+value;}
export function transferClaims(row:TransferReceipt):{remote:PathClaim[];local:PathClaim[]} {
  const remote:PathClaim[]=[{path:row.remoteParent,mode:'keep'},...(row.direction === 'upload' ? [row.destination,row.tempPath] : [row.source]).map(path => ({path,mode:'write' as const}))];
  const local:PathClaim[]=[{path:localPathLockKey(row.localParent),mode:'keep'},...(row.direction === 'upload' ? [row.source] : [row.destination,row.tempPath]).map(path => ({path:localPathLockKey(path),mode:'write' as const}))];
  return {remote,local};
}
