let tail:Promise<void>=Promise.resolve();
let nextAt=0;
// Keep legitimate demand below the main stream budget across all viewer and execution read streams.
// Only reserve start times; separate viewers may await SSH concurrently.
export function scheduleViewerFrame<T>(action:()=>Promise<T>):Promise<T> {
  const slot=tail.then(async () => {const wait=Math.max(0,nextAt-performance.now());if (wait) await new Promise(resolve => setTimeout(resolve,wait));nextAt=performance.now()+10;});
  tail=slot.catch(() => {});return slot.then(action);
}
