/** Reserve bounded control capacity even while normal reads are stalled. */
const cleanup=new Set(['pty:close','pty:pause','execution:close','execution:stop','viewer:cancel','file:close','transfer:cancel','transfer:release','mutation:finish']);
export const engineRequestCapacity=(action:string):number=>action==='session:disconnect' ? 32:cleanup.has(action) ? 28:24;
