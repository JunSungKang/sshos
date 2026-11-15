import { posix } from 'node:path';
import type { Stats } from 'ssh2';
import { executionSpecSchema,type ExecutionSpec } from '../../shared/executions';
import { initialStatSchema,type InitialStat } from '../../shared/mutations';
import { controlCall,verifyDirectory,type ControlAccess } from '../files/browser';
export class ExecutionInspector {
  constructor(private readonly control:(serverId:string,generation:number)=>ControlAccess) {}
  async inspect(serverId:string,generation:number,input:ExecutionSpec):Promise<InitialStat> {
    const spec=executionSpecSchema.parse(input),access=this.control(serverId,generation),parent=posix.dirname(spec.path);await verifyDirectory(access,parent);if(spec.cwd !== parent)await verifyDirectory(access,spec.cwd);
    const stat=await controlCall<Stats>(access,done=>access.sftp.lstat(spec.path,done));if(!stat.isFile() || stat.isSymbolicLink())throw new Error('PATH_UNSUPPORTED');if(spec.mode === 'direct' && !(stat.mode&0o111))throw new Error('EXEC_PERMISSION');
    return initialStatSchema.parse({type:'file',size:stat.size,mtime:stat.mtime,mode:stat.mode});
  }
}
