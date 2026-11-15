/** Opening, running and closing reservations share one six/global four/server cap. */
export class ExecutionSlots {
  private readonly slots=new Map<string,{serverId:string;generation:number}>();
  reserve(id:string,serverId:string,generation:number):void {
    if (this.slots.has(id)) throw new Error('INPUT_INVALID');if(this.slots.size>=6 || [...this.slots.values()].filter(row=>row.serverId === serverId).length>=4)throw new Error('SESSION_LIMIT');this.slots.set(id,{serverId,generation});
  }
  require(id:string,serverId:string,generation:number):void {const row=this.slots.get(id);if(!row || row.serverId !== serverId || row.generation !== generation)throw new Error('TOKEN_EXPIRED');}
  closed(id:string):void {this.slots.delete(id);}
  count(serverId?:string):number {return serverId === undefined ? this.slots.size : [...this.slots.values()].filter(row=>row.serverId === serverId).length;}
}
