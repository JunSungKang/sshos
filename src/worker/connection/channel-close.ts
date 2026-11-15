import { Duplex } from 'node:stream';
import type { ClientChannel } from 'ssh2';
/** ssh2 1.17.0 sets emitClose=false and emits close only after protocol/socket
 * closure. Its own destroy() only sends EOF/CLOSE. A paused readable otherwise
 * withholds end/close forever. Dispose its Node buffers without draining remote
 * output, retaining the genuine ssh2 close event as the reservation boundary.
 * This adapter never reads private timing fields or creates an RTT sample. */
export function closeDiscardedChannel(channel:ClientChannel):void {
 channel.pause?.();channel.stderr?.pause?.();try{channel.close();}catch{return;}
 const metadata=require('ssh2/package.json') as {version?:string};
 if(metadata.version==='1.17.0' && channel.constructor.name==='Channel' && channel.server===false && channel.stdout===channel && channel.stdin===channel && channel.stderr?.constructor.name==='ClientStderr'){
  Reflect.apply(Duplex.prototype.destroy,channel,[]);channel.stderr.destroy();
 }
}
