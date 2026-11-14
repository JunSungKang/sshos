type Lease={release():void};
type Waiting={id:string;serverId:string;resolve:(lease:Lease)=>void;reject:(error:Error)=>void};
export class ViewerReadPool {
  private readonly active=new Map<string,string>();
  private waiting:Waiting[]=[];
  acquire(id:string,serverId:string):Promise<Lease> {
    if (this.active.has(id) || this.waiting.some(row => row.id === id)) return Promise.reject(new Error('REQUEST_BUSY'));
    if (this.waiting.length>=32) return Promise.reject(new Error('REQUEST_BUSY'));
    return new Promise((resolve,reject) => {this.waiting.push({id,serverId,resolve,reject});this.pump();});
  }
  cancel(id:string):void {const row=this.waiting.find(value => value.id === id);if (!row) return;this.waiting=this.waiting.filter(value => value !== row);row.reject(new Error('REQUEST_CANCELLED'));}
  private pump():void {
    while (this.active.size<4) {
      const index=this.waiting.findIndex(row => [...this.active.values()].filter(server => server === row.serverId).length<2);if (index<0) return;
      const row=this.waiting.splice(index,1)[0]!;this.active.set(row.id,row.serverId);let released=false;
      row.resolve({release:() => {if (released) return;released=true;this.active.delete(row.id);this.pump();}});
    }
  }
}
