import {metadataCommand} from './metadata-commands.mjs';
import { fixtureKey } from './keys.mjs';
import ssh2 from 'ssh2';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, relative, isAbsolute, sep, posix } from 'node:path';
import { root } from '../environment.mjs';

// Test-only listener. Application code never imports this module.
export async function startSSHFixture(directory, options = {}) {
  const actual = await fs.realpath(directory); const rel = relative(root, actual);
  if (!rel || isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === '..') throw new Error('Workspace fixture required');
  const resolveRemote = path => {
    const name = path === '.' ? '/home/fixture' : path;
    if (!name.startsWith('/') || name.includes('\0')) throw new Error('Invalid fixture path');
    const result = resolve(actual, '.' + posix.normalize(name));
    const part = relative(actual, result);
    if (isAbsolute(part) || part.startsWith(`..${sep}`) || part === '..') throw new Error('Fixture escape');
    return result;
  };
  const status = ssh2.utils.sftp.STATUS_CODE; const host = fixtureKey();
  const pending=new Set();
  const connections = new Set(); const metrics = { authenticationRequests: 0, writes:0,renames:0,commands: [], metadataCommands:[], ptyRequests:[],shells:0,windowChanges:[],readDirRequests:0,readDirs: 0, openedPaths: [], mutations:[] };
  const server = new ssh2.Server({ hostKeys: [host.private] }, connection => {
    connections.add(connection); connection.on('close', () => connections.delete(connection)); connection.on('error', () => {});
    connection.on('authentication', ctx => { metrics.authenticationRequests++; if (ctx.method === 'password' && ctx.username === 'fixture' && ctx.password === 'test-only') ctx.accept(); else ctx.reject(['password']); });
    connection.on('session', accept => {
      const session = accept();
      session.on('pty',(acceptPTY,rejectPTY,info)=>{metrics.ptyRequests.push(info);if(options.shell)acceptPTY();else rejectPTY();});
      session.on('window-change',(acceptWindow,_rejectWindow,info)=>{metrics.windowChanges.push(info);acceptWindow?.();});
      session.on('shell',(acceptShell,rejectShell)=>{metrics.shells++;if(options.shell)options.shell({accept:acceptShell,reject:rejectShell,session});else rejectShell();});
      session.on('exec',(acceptExec,rejectExec,info)=>{metrics.commands.push(info.command);if(info.command==="u=$(id -u) && printf '%s\\n' \"$u\" && getent passwd \"$u\"" && !options.denyHome){const stream=acceptExec();stream.write('1000\nfixture:x:1000:1000::/home/fixture:/bin/sh\n');stream.exit(0);stream.end();return;}const action=metadataCommand(info.command,resolveRemote,options,metrics);if(action){metrics.metadataCommands.push(info.command);const stream=acceptExec();const operation=(async()=>{if(options.metadataDelayMs)await new Promise(resolve=>setTimeout(resolve,options.metadataDelayMs));return action();})().then(bytes=>{stream.write(bytes);stream.exit(0);stream.end();},()=>{stream.stderr.write('fixture command failed');stream.exit(1);stream.end();}).finally(()=>pending.delete(operation));pending.add(operation);return;}if(options.exec)options.exec({command:info.command,accept:acceptExec,reject:rejectExec,session});else rejectExec();});
      session.on('sftp', acceptSFTP => {
        const stream = acceptSFTP(); const handles = new Map();
        if (options.hardlink || options.atomicRename) {
          // Test-only ssh2 1.17.0 adapter: its server API always advertises no
          // extensions. Add the extension to this channel's VERSION packet.
          const protocol=stream._protocol;const previous=protocol.channelData;let advertised=false;
          const send=function(channel,bytes,...args) {
            if (!advertised && channel === stream.outgoing.id && bytes.length === 9 && bytes.readUInt32BE(0) === 5 && bytes[4] === 2 && bytes.readUInt32BE(5) === 3) {
              advertised=true;const extra=Buffer.concat([...(options.hardlink?['hardlink@openssh.com']:[]),...(options.atomicRename?['posix-rename@openssh.com']:[])].map(value=>{const name=Buffer.from(value),bytes=Buffer.alloc(4+name.length+4+1);bytes.writeUInt32BE(name.length);name.copy(bytes,4);bytes.writeUInt32BE(1,4+name.length);bytes[bytes.length-1]=49;return bytes;}));
              const packet=Buffer.concat([bytes,extra]);packet.writeUInt32BE(packet.length-4);stream.outgoing.window-=extra.length;
              if (protocol.channelData === send) protocol.channelData=previous;return previous.call(this,channel,packet,...args);
            }
            return previous.call(this,channel,bytes,...args);
          };protocol.channelData=send;
        }
        const fail = (id,error) => stream.status(id,error?.code === 'ENOENT' ? status.NO_SUCH_FILE : error?.code === 'EACCES' ? status.PERMISSION_DENIED : status.FAILURE);
        const run = (id, action) => {const operation=action().catch(error => {try {if (!stream.destroyed) fail(id,error);}catch {}}).finally(() => pending.delete(operation));pending.add(operation);};
        const addHandle = value => { const handle = randomBytes(8); handles.set(handle.toString('hex'),value); return handle; };
        const getHandle = handle => { const value = handles.get(handle.toString('hex')); if (!value) throw new Error('Missing handle'); return value; };
        const attrs = stat => ({ mode:stat.mode, uid:stat.uid, gid:stat.gid, size:stat.size, atime:Math.floor(stat.atimeMs/1000), mtime:Math.floor(stat.mtimeMs/1000) });
        stream.on('REALPATH', (id,path) => run(id,async () => {
          const physical = await fs.realpath(resolveRemote(path)); const part = relative(actual,physical);
          if (isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`)) throw new Error('Fixture symlink escape');
          stream.name(id,[{ filename:'/' + part.split(sep).join('/'), longname:'', attrs:{} }]);
        }));
        for (const [name,method] of [['LSTAT','lstat'],['STAT','stat']]) stream.on(name,(id,path) => run(id,async () => stream.attrs(id,attrs(await fs[method](resolveRemote(path))))));
        stream.on('OPENDIR',(id,path) => run(id,async () => { metrics.readDirs++; stream.handle(id,addHandle({ kind:'dir', path:resolveRemote(path), dir:await fs.opendir(resolveRemote(path)) })); }));
        stream.on('READDIR',(id,handle) => run(id,async () => {
          metrics.readDirRequests++;if(options.metadataDelayMs)await new Promise(resolve=>setTimeout(resolve,options.metadataDelayMs));
          const value = getHandle(handle); if (value.kind !== 'dir') throw new Error('Wrong handle');
          const names = [];
          for (let i=0;i<64;i++) { const entry = await value.dir.read(); if (!entry) break; const stat = await fs.lstat(resolve(value.path,entry.name)); names.push({ filename:entry.name, longname:'', attrs:attrs(stat) }); }
          if (names.length) stream.name(id,names); else stream.status(id,status.EOF);
        }));
        stream.on('OPEN',(id,path,flags) => run(id,async () => {
          metrics.openedPaths.push(path);
          const flag = ssh2.utils.sftp.flagsToString(flags); if (!flag) throw new Error('Unsupported flags');
          const readFailure=flag==='r' ? options.readFailure?.(path):null;
          if(readFailure){stream.status(id,readFailure.code,readFailure.message);return;}
          if (flag === 'r' && options.denyRead?.(path)) {stream.status(id,status.PERMISSION_DENIED);return;}
          stream.handle(id,addHandle({ kind:'file', path,flag,file:await fs.open(resolveRemote(path),flag,0o600) }));
        }));
        stream.on('FSETSTAT',(id,handle,attributes)=>run(id,async()=>{const value=getHandle(handle);if(value.kind!=='file')throw new Error('Wrong handle');if(attributes.uid!==undefined || attributes.gid!==undefined)await value.file.chown(attributes.uid,attributes.gid);if(attributes.mode!==undefined)await value.file.chmod(attributes.mode);stream.status(id,status.OK);}));
        stream.on('FSTAT',(id,handle) => run(id,async () => { const value = getHandle(handle); if (value.kind !== 'file') throw new Error('Wrong handle'); stream.attrs(id,attrs(await value.file.stat())); }));
        stream.on('READ',(id,handle,offset,length) => run(id,async () => {
          const value = getHandle(handle); if (value.kind !== 'file') throw new Error('Wrong handle'); const bytes = Buffer.alloc(Math.min(length,1024*1024));
          const {bytesRead} = await value.file.read(bytes,0,bytes.length,offset); if (bytesRead) stream.data(id,bytes.subarray(0,bytesRead)); else stream.status(id,status.EOF);
        }));
        stream.on('WRITE',(id,handle,offset,bytes) => run(id,async () => {
          metrics.writes++;const value=getHandle(handle);if (value.kind !== 'file') throw new Error('Wrong handle');await options.beforeWrite?.({path:value.path,offset,length:bytes.length});let written=0;
          while (written<bytes.length) {const result=await value.file.write(bytes,written,bytes.length-written,offset+written);if (!result.bytesWritten) throw new Error('Zero fixture write');written+=result.bytesWritten;}stream.status(id,status.OK);
        }));
        stream.on('EXTENDED',(id,name,bytes) => run(id,async () => {
          if (!(options.hardlink && name==='hardlink@openssh.com') && !(options.atomicRename && name==='posix-rename@openssh.com')) {stream.status(id,status.OP_UNSUPPORTED);return;}
          let offset=0;const take=() => {if (offset+4>bytes.length) throw new Error('Invalid fixture extension');const size=bytes.readUInt32BE(offset);offset+=4;if (size>4096 || offset+size>bytes.length) throw new Error('Invalid fixture extension');const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset,offset+size));offset+=size;return value;};
          const source=take(),destination=take();if (offset !== bytes.length) throw new Error('Invalid fixture extension');if(name==='posix-rename@openssh.com'){await options.beforeRename?.({source,destination});await fs.rename(resolveRemote(source),resolveRemote(destination));metrics.renames++;stream.status(id,status.OK);return;}await options.beforeLink?.({source,destination});await fs.link(resolveRemote(source),resolveRemote(destination));metrics.mutations.push({operation:'hardlink',source,destination});stream.status(id,status.OK);
        }));
        stream.on('MKDIR',(id,path,attributes) => run(id,async () => {metrics.mutations.push({operation:'mkdir',path});await fs.mkdir(resolveRemote(path),{mode:attributes.mode ?? 0o700});stream.status(id,status.OK);}));
        stream.on('REMOVE',(id,path) => run(id,async () => {metrics.mutations.push({operation:'unlink',path});await fs.unlink(resolveRemote(path));stream.status(id,status.OK);}));
        stream.on('RMDIR',(id,path) => run(id,async () => {metrics.mutations.push({operation:'rmdir',path});await fs.rmdir(resolveRemote(path));stream.status(id,status.OK);}));
        stream.on('CLOSE',(id,handle) => run(id,async () => { const value = getHandle(handle); handles.delete(handle.toString('hex')); await (value.kind === 'file' ? value.file.close() : value.dir.close());if (value.kind === 'file' && value.flag === 'wx') await options.afterWriteClose?.(value.path);stream.status(id,status.OK); }));
        stream.on('close',() => { stream.end(); for (const value of handles.values()) void (value.kind === 'file' ? value.file.close() : value.dir.close()).catch(() => {}); handles.clear(); });
      });
    });
  });
  await new Promise((done,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',done); });
  return { port:server.address().port, metrics, publicKey:ssh2.utils.parseKey(host.private).getPublicSSH(), async close() { for (const connection of connections) connection.end(); await new Promise(done => server.close(done));while (pending.size) await Promise.allSettled([...pending]); } };
}
