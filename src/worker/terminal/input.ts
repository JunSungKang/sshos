export class TerminalInputBoundary {
 private sequence=0;private inFlight=0;private readonly events:{at:number;bytes:number}[]=[];
 constructor(private readonly clock:()=>number=()=>performance.now()) {}
 get nextSequence():number {return this.sequence+1;}
 synchronize(nextSequence:number):void {if(!Number.isSafeInteger(nextSequence)||nextSequence<1 || this.inFlight)throw new Error('REQUEST_BUSY');this.sequence=nextSequence-1;}
 get pendingBytes():number {return this.inFlight;}
 reserve(sequence:number,bytes:Uint8Array,source:'key'|'paste'):()=>void {
  if((source !== 'key' && source !== 'paste') || !Number.isSafeInteger(sequence)||sequence !== this.sequence+1 || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length>65536 || source === 'key' && (bytes.length>4096 || bytes.some(byte=>byte===10||byte===13) && !(bytes.length === 1 && (bytes[0] === 10 || bytes[0] === 13))))throw new Error('INPUT_INVALID');
  const size=bytes.length;const now=this.clock();while(this.events.length && this.events[0]!.at<=now-1000)this.events.shift();
  if(this.events.length>=120 || this.events.reduce((sum,row)=>sum+row.bytes,0)+bytes.length>65536 || this.inFlight+bytes.length>65536)throw new Error('INPUT_LIMIT');
  this.sequence=sequence;this.events.push({at:now,bytes:bytes.length});this.inFlight+=bytes.length;let finished=false;return ()=>{if(finished)return;finished=true;this.inFlight-=size;};
 }
}
