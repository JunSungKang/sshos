import type { Client, SFTPWrapper } from 'ssh2';

type ChannelCallback=((error:Error|undefined|null,stream?:SFTPWrapper)=>void)&{type?:string};
type Manager={add(value:ChannelCallback):number};
export type ReadChannel={ready:Promise<SFTPWrapper>;closed:Promise<void>;cancel():void};

/** Pin-specific adapter: capture the SFTP channel at open confirmation, before
 * ssh2's public sftp callback waits for subsystem/INIT completion. Cancel never
 * destroys the shared SSH socket. A late channel confirmation is closed before
 * sending a subsystem request. Its pool slot remains reserved until close. */
export function openReadChannel(client:Client,timeoutMs=15000):ReadChannel {
  const metadata=require('ssh2/package.json') as {version?:string};
  const manager=(client as unknown as {_chanMgr?:Manager})._chanMgr;
  if (metadata.version !== '1.17.0' || !manager || typeof manager.add !== 'function') throw new Error('SFTP_UNAVAILABLE');
  let stream:SFTPWrapper|undefined;let cancelled=false;let settled=false;let closed=false;let reserved=false;
  let resolveReady!:(stream:SFTPWrapper)=>void,rejectReady!:(error:Error)=>void,resolveClosed!:()=>void;
  const ready=new Promise<SFTPWrapper>((resolve,reject) => {resolveReady=resolve;rejectReady=reject;});
  const closure=new Promise<void>(resolve => {resolveClosed=resolve;});
  const finishClosed=() => {if (closed) return;closed=true;clearTimeout(timer);client.removeListener('close',finishClosed);if (!settled) {settled=true;rejectReady(new Error(cancelled ? 'REQUEST_CANCELLED' : 'SFTP_UNAVAILABLE'));}resolveClosed();};
  const cancel=() => {cancelled=true;clearTimeout(timer);if (!settled) {settled=true;rejectReady(new Error('REQUEST_CANCELLED'));}stream?.end();};
  const timer=setTimeout(() => {if (!settled) {settled=true;rejectReady(new Error('IO_TIMEOUT'));}cancel();},timeoutMs);
  client.once('close',finishClosed);
  const original=manager.add;
  manager.add=function(value:ChannelCallback):number {
    if (typeof value !== 'function' || value.type !== 'sftp') return original.call(this,value);
    const wrapped:ChannelCallback=(error,channel) => {
      if (channel) {stream=channel;channel.on('error',() => {});channel.once('close',finishClosed);}
      if (error) {finishClosed();value(error);return;}
      if (cancelled) {channel?.end();value(new Error('REQUEST_CANCELLED'));return;}
      value(error,channel);
    };
    wrapped.type=value.type;const id=original.call(this,wrapped);reserved=id>=0;return id;
  };
  try {
    client.sftp((error,sftp) => {
      if (settled) {if (cancelled) sftp?.end();return;}
      clearTimeout(timer);settled=true;
      if (error || !sftp) {rejectReady(new Error('SFTP_UNAVAILABLE'));stream?.end();if (!stream) finishClosed();return;}
      resolveReady(sftp);
    });
  } catch {
    clearTimeout(timer);if (!settled) {settled=true;rejectReady(new Error('SFTP_UNAVAILABLE'));}cancel();if (!reserved) finishClosed();
  } finally {manager.add=original;}
  return {ready,closed:closure,cancel};
}
