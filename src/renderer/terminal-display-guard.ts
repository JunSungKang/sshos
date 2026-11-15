const disposers=new Set<()=>void>();let lastToken:string|null=null;
export function registerTerminalDisplayGuard(dispose:()=>void):()=>void {disposers.add(dispose);return()=>{disposers.delete(dispose);};}
/** Synchronous disposal completes before the main-owned acknowledgement. */
export function applyTerminalDisplayLimit(token:string):void {if(lastToken===token)return;lastToken=token;for(const dispose of [...disposers])dispose();}
