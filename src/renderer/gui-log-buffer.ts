export type LogLine={key:number;stream:'stdout'|'stderr';text:string;terminated:boolean};
const safe=(text:string)=>text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu,char=>`\\x${char.charCodeAt(0).toString(16).padStart(2,'0')}`);
export class GUILogBuffer {
 private lines:LogLine[]=[];private chars=0;private sequence=0;private decoders={stdout:new TextDecoder(),stderr:new TextDecoder()};omitted=false;
 constructor(private readonly maxChars=4*1024**2,private readonly maxLines=20000,private readonly maxLine=100000) {}
 clear():void {this.lines=[];this.chars=0;this.decoders={stdout:new TextDecoder(),stderr:new TextDecoder()};this.omitted=false;}
 gap():void {this.decoders={stdout:new TextDecoder(),stderr:new TextDecoder()};this.omitted=true;const last=this.lines.at(-1);if(last)last.terminated=true;}
 append(stream:'stdout'|'stderr',bytes:Uint8Array):void {this.text(stream,safe(this.decoders[stream].decode(bytes,{stream:true})));}
 finish():void {for(const stream of ['stdout','stderr'] as const)this.text(stream,safe(this.decoders[stream].decode()));}
 private text(stream:'stdout'|'stderr',text:string):void {
  if(!text)return;const parts=text.split('\n');
  for(const [index,part]of parts.entries()) {if(index === parts.length-1 && !part && index>0)break;let last=this.lines.at(-1);if(!last || last.stream !== stream || last.terminated){last={key:++this.sequence,stream,text:'',terminated:false};this.lines.push(last);}last.text+=part;this.chars+=part.length;if(last.text.length>this.maxLine){const removed=last.text.length-this.maxLine;last.text=last.text.slice(removed);this.chars-=removed;this.omitted=true;}if(index<parts.length-1)last.terminated=true;}
  let count=0;while(count<this.lines.length && (this.lines.length-count>this.maxLines || this.chars>this.maxChars)){this.chars-=this.lines[count++]!.text.length;this.omitted=true;}if(count)this.lines.splice(0,count);
 }
 snapshot():LogLine[] {return this.lines.map(row=>({...row}));}
}
