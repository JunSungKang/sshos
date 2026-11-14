let tail:Promise<void>=Promise.resolve();
// Bound aggregate paging across all six explorers instead of consuming the IPC
// budget independently in each window. Directory contents are never polled here.
export function scheduleFilePage<T>(action:()=>Promise<T>):Promise<T> {
  const next=tail.then(async () => {await new Promise(resolve => setTimeout(resolve,100));return action();});
  tail=next.then(() => {},() => {});return next;
}
