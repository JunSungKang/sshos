import { afterEach,describe,expect,it,vi } from 'vitest';
import { RendererMemoryGuard } from '../../src/main/renderer-memory';
afterEach(()=>vi.useRealTimers());
describe('renderer memory boundary',()=>{
 it('uses strict1536MiB, consecutive samples and a matching renderer ACK',()=>{
  vi.useFakeTimers();let row:{key:string;workingSetKiB:number|null}={key:'a:10',workingSetKiB:1536*1024};const block=vi.fn(),replace=vi.fn(),guard=new RendererMemoryGuard(()=>row,block,replace);
  vi.advanceTimersByTime(2000);expect(block).not.toHaveBeenCalled();row.workingSetKiB++;vi.advanceTimersByTime(1000);row.workingSetKiB=null;vi.advanceTimersByTime(1000);row.workingSetKiB=1536*1024+1;vi.advanceTimersByTime(1000);expect(block).not.toHaveBeenCalled();vi.advanceTimersByTime(1000);expect(block).toHaveBeenCalledTimes(1);const token=guard.displayToken!;expect(guard.acknowledge('b:10',token)).toBe(false);expect(guard.acknowledge(row.key,token)).toBe(true);vi.advanceTimersByTime(10000);expect(replace).not.toHaveBeenCalled();expect(block).toHaveBeenCalledTimes(1);row.workingSetKiB=100;vi.advanceTimersByTime(1000);row.workingSetKiB=2000*1024;vi.advanceTimersByTime(2000);expect(block).toHaveBeenCalledTimes(2);expect(guard.displayToken).not.toBe(token);guard.dispose();
 });
 it('replaces only the unresponsive owner and clears stale tokens on process change',()=>{
  vi.useFakeTimers();let row:{key:string;workingSetKiB:number|null}|null={key:'a:10',workingSetKiB:2000*1024};const block=vi.fn(),replace=vi.fn(),guard=new RendererMemoryGuard(()=>row,block,replace);
  vi.advanceTimersByTime(2000);const token=guard.displayToken!;vi.advanceTimersByTime(1999);expect(replace).not.toHaveBeenCalled();vi.advanceTimersByTime(1);expect(replace).toHaveBeenCalledExactlyOnceWith('a:10');row={key:'a:11',workingSetKiB:100};vi.advanceTimersByTime(1000);expect(guard.displayToken).toBeNull();expect(guard.acknowledge('a:10',token)).toBe(false);row.workingSetKiB=2000*1024;vi.advanceTimersByTime(2000);row=null;vi.advanceTimersByTime(2000);expect(replace).toHaveBeenCalledTimes(1);guard.dispose();
 });
});
