import { posix } from 'node:path';
import type { Stats } from 'ssh2';
import { remotePathSchema } from '../../shared/files';
import type { TransferStat } from '../../shared/transfers';
import { controlCall,verifyDirectory,type ControlAccess } from '../files/browser';
import { remoteTransferStat } from './ports';
export class TransferInspector {
  constructor(private readonly control:(serverId:string,generation:number)=>ControlAccess) {}
  async inspect(serverId:string,generation:number,direction:'upload'|'download',path:string,parent:string):Promise<TransferStat|null> {
    remotePathSchema.parse(path);if (path === '/' || posix.dirname(path) !== parent) throw new Error('PATH_UNSUPPORTED');const control=this.control(serverId,generation);await verifyDirectory(control,parent);
    let stat:Stats;
    try {stat=await controlCall<Stats>(control,done => control.sftp.lstat(path,done));}
    catch (error) {if ((error as {code?:number}).code === 2) {if (direction === 'upload') return null;throw new Error('PATH_UNSUPPORTED');}throw error;}
    if (direction === 'upload') throw new Error('NAME_CONFLICT');return remoteTransferStat(stat);
  }
}
