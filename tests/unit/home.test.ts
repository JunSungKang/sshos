import {EventEmitter} from 'node:events';
import type {Client} from 'ssh2';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {parseHome,HOME_COMMAND,resolveAccountHome} from '../../src/worker/connection/home';
import {stateSchema,initialState} from '../../src/shared/models';
describe('verified account home metadata',()=>{
 it('accepts an exact UID/passwd response with a nonstandard absolute home',()=>{expect(parseHome(Buffer.from('42\nuser:x:42:42::/srv/account:/bin/bash\n'))).toBe('/srv/account');expect(HOME_COMMAND).toBe('u=$(id -u) && printf \'%s\\n\' "$u" && getent passwd "$u"');});
 it.each(['42\nuser:x:43:42::/home/user:/bin/sh\n','banner\n42\nuser:x:42:42::/home/user:/bin/sh\n','42\nuser:x:42:42::relative:/bin/sh\n','42\nuser:x:42:42::/a/../b:/bin/sh\n','42\nuser:x:42:42::/home/user:/bin/sh\nextra','42\nuser:x:42:42::/home/\0user:/bin/sh\n'])('rejects ambiguous or unsafe metadata %j',text=>{expect(()=>parseHome(Buffer.from(text))).toThrow();});
 it('rejects invalid UTF8 and oversized input',()=>{expect(()=>parseHome(Uint8Array.from([255]))).toThrow();expect(()=>parseHome(new Uint8Array(16385))).toThrow();});
 it('migrates absent hidden preference to false without accepting a corrupt value',()=>{const old=initialState() as any;delete old.settings.showHiddenFiles;expect(stateSchema.parse(old).settings.showHiddenFiles).toBe(false);old.settings.showHiddenFiles='false';expect(()=>stateSchema.parse(old)).toThrow();});
});

afterEach(()=>vi.useRealTimers());
function channel(){const stream=new EventEmitter() as any;stream.stderr=new EventEmitter();stream.close=vi.fn();return stream;}
it('requires exit zero and a complete bounded reply, rejecting failures and late callbacks',async()=>{
 const stream=channel(),client={exec:vi.fn((_cmd:string,cb:Function)=>cb(null,stream))} as unknown as Client;
 const ok=resolveAccountHome(client);stream.emit('data',Buffer.from('1\nu:x:1:1::/srv/u:/bin/sh\n'));stream.emit('exit',0);stream.emit('close');expect(await ok).toBe('/srv/u');
 for(const fault of ['stderr','oversize','exit','error']){const ch=channel(),pending=resolveAccountHome({exec:(_cmd:string,cb:Function)=>cb(null,ch)} as unknown as Client);const rejected=expect(pending).rejects.toThrow();if(fault==='stderr')ch.stderr.emit('data',Buffer.from('denied'));if(fault==='oversize')ch.emit('data',Buffer.alloc(16385));if(fault==='exit'){ch.emit('exit',1);ch.emit('close');}if(fault==='error')ch.emit('error',new Error('closed'));await rejected;}
 await expect(resolveAccountHome({exec:(_cmd:string,cb:Function)=>cb(new Error('denied'))} as unknown as Client)).rejects.toThrow('denied');
 await expect(resolveAccountHome({exec:()=>{throw new Error('sync');}} as unknown as Client)).rejects.toThrow('sync');
});
it('closes a timed-out channel and a channel delivered after timeout',async()=>{
 vi.useFakeTimers();let deliver!:Function;const pending=resolveAccountHome({exec:(_cmd:string,cb:Function)=>{deliver=cb;}} as unknown as Client);const rejected=expect(pending).rejects.toThrow('IO_TIMEOUT');await vi.advanceTimersByTimeAsync(5000);await rejected;const late=channel();deliver(null,late);expect(late.close).toHaveBeenCalledOnce();
 const ch=channel(),again=resolveAccountHome({exec:(_cmd:string,cb:Function)=>cb(null,ch)} as unknown as Client);const failed=expect(again).rejects.toThrow('IO_TIMEOUT');await vi.advanceTimersByTimeAsync(5000);await failed;expect(ch.close).toHaveBeenCalledOnce();ch.emit('data',Buffer.from('late'));ch.emit('close');
});
