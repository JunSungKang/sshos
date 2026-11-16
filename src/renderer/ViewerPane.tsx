import { ErrorPanel } from './ErrorPanel';
import { errorCodeOf } from '../shared/errors';
import { useEffect, useRef, useState } from 'react';
import type { SessionView } from '../shared/session-contracts';
import type { ViewerDescriptor } from '../shared/viewers/reader';
import {TEXT_LIMIT,type DecodedText } from '../shared/viewers/text';
import type { ImageHeader } from '../shared/viewers/image-header';
import { ViewerDecoder } from './ViewerDecoder';
import { scheduleViewerFrame } from './viewer-stream-scheduler';

const explain=errorCodeOf;
export function ViewerPane({windowId,kind,session,onName}:{windowId:string;kind:'text'|'image';session?:SessionView;onName(name:string,serverName:string):void}) {
  const [descriptor,setDescriptor]=useState<ViewerDescriptor|null>(null);const descriptorRef=useRef<ViewerDescriptor|null>(null);
  const [text,setText]=useState<DecodedText|null>(null);const [image,setImage]=useState<ImageHeader|null>(null);
  const [displayed,setDisplayed]=useState<{bytes:number;readAt:string|null}|null>(null);
  const [status,setStatus]=useState('파일 정보 확인 중');const [error,setError]=useState('');
  const [progress,setProgress]=useState({read:0,total:0});const [restartPending,setRestartPending]=useState(false);
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[editBusy,setEditBusy]=useState(false),[discard,setDiscard]=useState(false);const discardDialog=useRef<HTMLDialogElement>(null);
  const dirty=editing && draft!==text?.text;
  useEffect(()=>{if(discard)discardDialog.current?.showModal();},[discard]);
  const [zoom,setZoom]=useState<'fit'|25|50|100|200>('fit');const [area,setArea]=useState({width:500,height:300});
  const viewport=useRef<HTMLDivElement>(null);const canvas=useRef<HTMLCanvasElement>(null);const decoder=useRef<ViewerDecoder|null>(null);
  const alive=useRef(true);const job=useRef(0);const nameCallback=useRef(onName);nameCallback.current=onName;
  const connected=descriptor !== null && session?.status === 'connected' && session.serverId === descriptor.serverId && session.generation === descriptor.generation;
  const consume=async (value:ViewerDescriptor) => {
    const id=++job.current;decoder.current?.dispose();setError('');setProgress({read:0,total:0});let current:ViewerDecoder|null=null;let complete=false;
    let sequence=0,read=0,lastProgress=0,previousStatus='';
    const statusChanged=(label:string) => {if (previousStatus !== label) {previousStatus=label;setStatus(label);}};
    try {
      while (alive.current && job.current === id) {
        const frame=await scheduleViewerFrame(() => {if (!alive.current || job.current !== id) throw new Error('REQUEST_CANCELLED');return window.sshOS.viewer.next(value.viewerToken,value.readGeneration,sequence);});
        if (!alive.current || job.current !== id) return;
        if (frame.status === 'waiting') {statusChanged(frame.phase === 'queued' ? '읽기 대기' : '파일 확인 중');await new Promise(resolve => setTimeout(resolve,250));continue;}
        if (!current) {current=new ViewerDecoder(`${value.viewerId}:${value.readGeneration}`,kind,frame.metadata.size);decoder.current=current;}
        if (frame.status === 'chunk') {
          const count=frame.bytes.byteLength;await current.consume(frame.sequence,frame.bytes);read+=count;sequence++;
          if (!alive.current || job.current !== id) return;statusChanged('내용 읽는 중');
          const now=performance.now();if (now-lastProgress>=250) {lastProgress=now;setProgress({read,total:frame.metadata.size});}continue;
        }
        statusChanged(kind === 'image' ? '이미지 해석 중' : '텍스트 확인 중');setProgress({read,total:frame.metadata.size});
        const result=await current.finish();
        if (!alive.current || job.current !== id) {if (result.type === 'image') result.bitmap.close();return;}
        if (result.type === 'text') {if (kind !== 'text') throw new Error('INTERNAL_ERROR');setText(result);}
        else {
          const element=canvas.current;const context=element?.getContext('bitmaprenderer');
          if (!element || !context || kind !== 'image') {result.bitmap.close();throw new Error('INTERNAL_ERROR');}
          element.width=result.header.width;element.height=result.header.height;context.transferFromImageBitmap(result.bitmap);setImage(result.header);
        }
        setDisplayed({bytes:frame.metadata.size,readAt:frame.metadata.readAt});setStatus('읽기 전용');setDescriptor(previous => previous ? {...previous,readState:'complete',lastReadAt:frame.metadata.readAt} : previous);complete=true;return;
      }
    } catch (failure) {if (alive.current && job.current === id) {setError(explain(failure));setStatus('읽기 중단');}}
    finally {current?.dispose();if (decoder.current === current) decoder.current=null;if (!complete) void window.sshOS.viewer.stopRead(value.viewerToken,value.readGeneration).catch(() => {});}
  };
  useEffect(() => {
    alive.current=true;const imageCanvas=canvas.current;
    void window.sshOS.viewer.get(windowId).then(value => {
      if (!alive.current) return;descriptorRef.current=value;setDescriptor(value);nameCallback.current(value.name,value.serverName);
      if (value.readState === 'pending' && value.nextSequence === 0) void consume(value);
      else {setStatus('다시 읽기를 요청하세요');if (value.readState === 'pending') void window.sshOS.viewer.stopRead(value.viewerToken,value.readGeneration).catch(() => {});}
    }).catch(failure => {if (alive.current) setError(explain(failure));});
    return () => {alive.current=false;job.current++;decoder.current?.dispose();const value=descriptorRef.current;if (value) void window.sshOS.viewer.stopRead(value.viewerToken,value.readGeneration).catch(() => {});imageCanvas?.getContext('bitmaprenderer')?.transferFromImageBitmap(null);if (imageCanvas) {imageCanvas.width=0;imageCanvas.height=0;}};
  },[windowId]);
  useEffect(() => {const element=viewport.current;if (!element) return;const observer=new ResizeObserver(() => {if (element.clientWidth>0 && element.clientHeight>0) setArea({width:element.clientWidth,height:element.clientHeight});});observer.observe(element);return () => observer.disconnect();},[]);
  const reread=async () => {
    const previous=descriptorRef.current;if (!previous || restartPending) return;setRestartPending(true);job.current++;decoder.current?.dispose();
    try {const next=await window.sshOS.viewer.reread(previous.viewerToken);if (!alive.current) return;descriptorRef.current=next;setDescriptor(next);void consume(next);}
    catch (failure) {if (alive.current) {setError(explain(failure));setStatus('읽기 중단');}}
    finally {if (alive.current) setRestartPending(false);}
  };
  const beginEdit=async()=>{const value=descriptorRef.current;if(!value || !text || editBusy)return;setEditBusy(true);setError('');try{await window.sshOS.viewer.setEditing(value.viewerToken,value.readGeneration,true);if(alive.current){setDraft(text.text);setEditing(true);setStatus('편집 중 · 저장 전에는 원격 파일이 변경되지 않습니다.');}}catch(failure){if(alive.current)setError(explain(failure));}finally{if(alive.current)setEditBusy(false);}};
  const cancelEdit=async()=>{const value=descriptorRef.current;if(!value || editBusy)return;setEditBusy(true);try{await window.sshOS.viewer.setEditing(value.viewerToken,value.readGeneration,false);if(alive.current){setEditing(false);setDraft('');setDiscard(false);setStatus('읽기 전용');}}catch(failure){if(alive.current)setError(explain(failure));}finally{if(alive.current)setEditBusy(false);}};
  const save=async()=>{const value=descriptorRef.current;if(!value || editBusy || !dirty || !connected)return;setEditBusy(true);setError('');setStatus('원격 파일 저장 중');try{await window.sshOS.viewer.saveText(value.viewerToken,value.readGeneration,draft);await window.sshOS.viewer.setEditing(value.viewerToken,value.readGeneration,false);if(!alive.current)return;setEditing(false);setDraft('');await reread();}catch(failure){if(alive.current){setError(explain(failure));setStatus('저장 실패 · 편집 내용을 유지합니다.');}}finally{if(alive.current)setEditBusy(false);}};
  const scale=image ? zoom === 'fit' ? Math.max(0.001,Math.min(1,(area.width-32)/image.width,(area.height-32)/image.height)) : zoom/100 : 1;
  return <section className="viewer-pane" aria-label={kind === 'text' ? '텍스트 뷰어' : '이미지 뷰어'}>
    <div className="viewer-toolbar"><button disabled={!connected || restartPending || editing || editBusy} onClick={() => {void reread();}}>다시 읽기</button><strong>{editing?'편집 모드':'읽기 전용'}</strong>{kind==='text' && (editing?<><button disabled={!connected || editBusy || !dirty} onClick={()=>{void save();}}>저장</button><button disabled={editBusy} onClick={()=>{if(dirty)setDiscard(true);else void cancelEdit();}}>편집 취소</button>{dirty && <span>저장하지 않은 변경</span>}</>:<button disabled={!connected || !text || text.lineEnding==='mixed' || descriptor?.readState!=='complete' || editBusy || restartPending || session?.os!=='supported' && !session?.osConfirmed} onClick={()=>{void beginEdit();}}>편집</button>)}{kind === 'image' && <label>배율<select aria-label="이미지 배율" value={zoom} onChange={event => setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value) as 25|50|100|200)}><option value="fit">화면 맞춤</option>{[25,50,100,200].map(value => <option value={value} key={value}>{value}%</option>)}</select></label>}</div>
    <div className="viewer-location">{descriptor?.endpoint}<code>{descriptor?.path}</code></div>
    {descriptor && !connected && <p className="file-warning">{editing?'연결 끊김 · 편집 내용은 유지하며 저장할 수 없습니다.':'연결 끊김 · 마지막 표시 내용을 읽기 전용으로 유지합니다.'}</p>}
    {error && <ErrorPanel error={error} phase={null} target={descriptor?.path ?? null}/>}
    <div className="viewer-viewport" ref={viewport}>
      {kind === 'text' ? editing?<textarea className="text-editor" aria-label="텍스트 편집 내용" value={draft} readOnly={editBusy || !connected} spellCheck={false} maxLength={TEXT_LIMIT} onChange={event=>setDraft(event.currentTarget.value)} onKeyDown={event=>{if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s'){event.preventDefault();void save();}}}/>:text ? <VirtualText value={text} /> : <p className="viewer-empty">{status}</p> : <div className="image-surface"><canvas ref={canvas} role="img" aria-label={descriptor ? `${descriptor.name} 이미지` : '이미지'} style={{width:image ? image.width*scale : 0,height:image ? image.height*scale : 0}} />{!image && <p className="viewer-empty">{status}</p>}</div>}
    </div>
    <output className="viewer-status" aria-live="polite" aria-label="뷰어 읽기 상태">{status}{status === '내용 읽는 중' ? ` · ${progress.read.toLocaleString()}/${progress.total.toLocaleString()} byte` : ''}</output>
    <div className="viewer-metadata">{kind === 'text' && text ? `UTF-8${text.hasBOM?' BOM':''} · ${text.lineEnding==='mixed'?'혼합/CR 줄바꿈 · 편집 불가':text.lineEnding.toUpperCase()}` : image ? `${image.format.toUpperCase()} · ${image.width}×${image.height}` : '텍스트2MiB · PNG/JPG/JPEG/WebP 20MiB/40MP 한도'} · {displayed ? `${displayed.bytes.toLocaleString()} byte · 마지막 읽음 ${displayed.readAt ? new Date(displayed.readAt).toLocaleString() : '미확인'}` : '표시한 내용 없음'}</div>
    {discard && <dialog ref={discardDialog} className="connection-dialog" aria-label="편집 취소 확인" onCancel={()=>setDiscard(false)}><h2>편집 내용을 버릴까요?</h2><p>원격 파일은 변경하지 않습니다.</p><button onClick={()=>setDiscard(false)}>계속 편집</button><button disabled={editBusy} onClick={()=>{void cancelEdit();}}>변경 버리기</button></dialog>}
  </section>;
}

function VirtualText({value}:{value:DecodedText}) {
  const root=useRef<HTMLDivElement>(null);const [scroll,setScroll]=useState(0);const [height,setHeight]=useState(300);const [all,setAll]=useState(false);
  useEffect(() => {const element=root.current;if (!element) return;const observer=new ResizeObserver(() => {if (element.clientHeight>0) setHeight(element.clientHeight);});observer.observe(element);return () => observer.disconnect();},[]);
  const total=value.lineStarts.length,physical=Math.min(16000000,total*20),scale=total*20/physical,logical=scroll*scale;
  const first=Math.max(0,Math.floor(logical/20)-8),last=Math.min(total,first+Math.ceil(height/20)+16);
  return <div ref={root} className={`viewer-text ${all ? 'all-selected' : ''}`} role="textbox" aria-label="텍스트 내용" aria-readonly="true" aria-multiline="true" tabIndex={0} onScroll={event => setScroll(event.currentTarget.scrollTop)} onPointerDown={() => setAll(false)} onBlur={() => setAll(false)}
    onKeyDown={event => {if ((event.metaKey || event.ctrlKey && !navigator.platform.includes('Mac')) && event.key.toLowerCase() === 'a') {event.preventDefault();setAll(true);const selection=window.getSelection();selection?.selectAllChildren(event.currentTarget);}}}
    onCopy={event => {if (all) {event.clipboardData.setData('text/plain',value.text);event.preventDefault();}}}>
    <div style={{height:physical,position:'relative'}}>{Array.from({length:last-first},(_,index) => {const line=first+index;const start=value.lineStarts[line]!;const end=value.lineStarts[line+1] === undefined ? value.text.length : value.lineStarts[line+1]!-1;return <div className="virtual-text-line" key={line} style={{position:'absolute',top:line*20-logical+scroll,left:0,height:20}}><span aria-hidden="true">{line+1}</span><pre>{value.text.slice(start,end)}</pre></div>;})}</div>
  </div>;
}
