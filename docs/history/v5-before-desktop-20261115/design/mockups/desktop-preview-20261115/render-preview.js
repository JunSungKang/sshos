/* Design-only screenshot renderer. No app, network, or SSH implementation. */
ObjC.import('AppKit');
ObjC.import('Foundation');

function run(argv) {
  var allowed='/Users/kkkk/Desktop/jskang/03.workspace/01.project/sshOS';
  if (argv.length!==1) throw new Error('Pass the authorized project root.');
  var root=ObjC.unwrap($(argv[0]).stringByStandardizingPath.stringByResolvingSymlinksInPath);
  if(root!==allowed) throw new Error('Unauthorized output root');
  var out=root+'/design/mockups/desktop-preview-20261115';
  if(ObjC.unwrap($(out).stringByResolvingSymlinksInPath)!==out) throw new Error('Symlink output is not allowed');
  var W=1600,H=1000,S=2;
  var C={bg:'#DCE7EB',rail:'#102D35',paper:'#F8FAFB',white:'#FFFFFF',ink:'#16313B',muted:'#667D86',faint:'#8B9EA5',border:'#D6E1E5',teal:'#087F78',tealDark:'#086B65',mint:'#E9F5F2',navActive:'#1E5157',blue:'#3868AD',bluePale:'#EDF3FC',amber:'#9C6817',amberPale:'#FFF5E2',red:'#A84B47',redPale:'#FAEFED'};
  var bitmap,svg,overflow=[];
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function col(s){return $.NSColor.colorWithSRGBRedGreenBlueAlpha(parseInt(s.slice(1,3),16)/255,parseInt(s.slice(3,5),16)/255,parseInt(s.slice(5,7),16)/255,1);}
  function rect(x,y,w,h,fill,stroke,r,sw){
    var p=$.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius($.NSMakeRect(x,H-y-h,w,h),r||0,r||0);
    if(fill){col(fill).setFill;p.fill;} if(stroke){col(stroke).setStroke;p.setLineWidth(sw||1);p.stroke;}
    svg.push('<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+(r||0)+'" fill="'+(fill||'none')+'" stroke="'+(stroke||'none')+'" stroke-width="'+(sw||1)+'"/>');
  }
  function line(a,b,color,width){poly([a,b],color,width,false,null);}
  function poly(points,color,width,closed,fill){
    var p=$.NSBezierPath.bezierPath;p.moveToPoint($.NSMakePoint(points[0][0],H-points[0][1]));
    for(var i=1;i<points.length;i++)p.lineToPoint($.NSMakePoint(points[i][0],H-points[i][1]));
    if(closed)p.closePath;if(fill){col(fill).setFill;p.fill;}if(color){col(color).setStroke;p.setLineWidth(width||1.6);p.stroke;}
    svg.push('<'+(closed?'polygon':'polyline')+' points="'+points.map(function(a){return a.join(',');}).join(' ')+'" fill="'+(fill||'none')+'" stroke="'+(color||'none')+'" stroke-width="'+(width||1.6)+'" stroke-linejoin="round"/>');
  }
  function circle(x,y,r,fill,stroke){var p=$.NSBezierPath.bezierPathWithOvalInRect($.NSMakeRect(x-r,H-y-r,r*2,r*2));if(fill){col(fill).setFill;p.fill;}if(stroke){col(stroke).setStroke;p.setLineWidth(1.5);p.stroke;}svg.push('<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="'+(fill||'none')+'" stroke="'+(stroke||'none')+'"/>');}
  function attrs(size,color,bold,mono){
    var f=$.NSFont.fontWithNameSize($(mono?'Menlo-Regular':bold?'AppleSDGothicNeo-SemiBold':'AppleSDGothicNeo-Regular'),size);
    if(!f)f=$.NSFont.systemFontOfSize(size);
    var a=$.NSMutableDictionary.alloc.init;a.setObjectForKey(f,$.NSFontAttributeName);a.setObjectForKey(col(color||C.ink),$.NSForegroundColorAttributeName);return a;
  }
  function tw(s,size,bold,mono){return Number($(String(s)).sizeWithAttributes(attrs(size,C.ink,bold,mono)).width);}
  function txt(s,x,y,size,color,bold,maxw,mono){
    s=String(s);if(maxw&&tw(s,size,bold,mono)>maxw){while(s.length&&tw(s+'…',size,bold,mono)>maxw)s=s.slice(0,-1);s+='…';}
    var width=tw(s,size,bold,mono);if(x<0||y<0||x+width>W+1||y+size*1.3>H+1)overflow.push(s);
    $(s).drawAtPointWithAttributes($.NSMakePoint(x,H-y-size*1.23),attrs(size,color,bold,mono));
    svg.push('<text x="'+x+'" y="'+(y+size)+'" font-family="'+(mono?'Menlo, monospace':'Apple SD Gothic Neo, sans-serif')+'" font-size="'+size+'" font-weight="'+(bold?600:400)+'" fill="'+(color||C.ink)+'">'+esc(s)+'</text>');
  }
  function center(s,x,y,w,size,color,bold){txt(s,x+(w-tw(s,size,bold,false))/2,y,size,color,bold);}
  function badge(s,x,y,w,color,bg){rect(x,y,w,27,bg,null,13);center(s,x,y+4,w,12,color,true);}
  function button(s,x,y,w,kind,iconName){
    var fill=kind==='primary'?C.teal:kind==='disabled'?'#F0F3F4':C.white;
    var ink=kind==='primary'?C.white:kind==='disabled'?'#9BAAB0':C.ink;
    rect(x,y,w,40,fill,kind==='primary'?fill:C.border,7);
    if(iconName){icon(iconName,x+13,y+11,18,ink);txt(s,x+39,y+10,14,ink,true);}else center(s,x,y+10,w,14,ink,true);
  }
  function progress(x,y,w,value,color){rect(x,y,w,5,'#E3EAED',null,2.5);rect(x,y,Math.max(0,w*value/100),5,color||C.teal,null,2.5);}
  function chevron(x,y,color,down){poly(down?[[x,y],[x+5,y+5],[x+10,y]]:[[x,y],[x+5,y+5],[x,y+10]],color,1.5,false,null);}
  function icon(name,x,y,s,color){
    color=color||C.muted;var u=s/24;function P(a){return a.map(function(v){return[x+v[0]*u,y+v[1]*u];});}
    if(name==='desktop'){rect(x+u,y+2*u,22*u,15*u,null,color,2);line([x+12*u,y+17*u],[x+12*u,y+22*u],color,1.7);line([x+7*u,y+22*u],[x+17*u,y+22*u],color,1.7);}
    else if(name==='terminal'){rect(x+u,y+2*u,22*u,20*u,null,color,3);poly(P([[5,7],[10,12],[5,17]]),color,1.8,false);line([x+13*u,y+17*u],[x+19*u,y+17*u],color,1.7);}
    else if(name==='play'){poly(P([[7,3],[21,12],[7,21]]),color,1.4,true,color);}
    else if(name==='image'){rect(x+u,y+2*u,22*u,20*u,null,color,2);circle(x+7*u,y+8*u,2*u,null,color);poly(P([[3,20],[10,12],[14,16],[18,11],[22,17]]),color,1.5,false);}
    else if(name==='home'){poly(P([[2,10],[12,2],[22,10]]),color,1.7,false);poly(P([[5,9],[5,22],[10,22],[10,15],[15,15],[15,22],[20,22],[20,9]]),color,1.7,false);}
    else if(name==='folder'){poly(P([[2,5],[9,5],[11,8],[22,8],[22,21],[2,21]]),color,1.6,true);}
    else if(name==='file'){poly(P([[5,2],[15,2],[21,8],[21,22],[5,22]]),color,1.5,true);poly(P([[15,2],[15,8],[21,8]]),color,1.3,false);line([x+8*u,y+13*u],[x+17*u,y+13*u],color,1.2);line([x+8*u,y+17*u],[x+15*u,y+17*u],color,1.2);}
    else if(name==='server'){rect(x+u,y+2*u,s-2*u,8*u,null,color,2);rect(x+u,y+14*u,s-2*u,8*u,null,color,2);circle(x+5*u,y+6*u,1.2*u,color);circle(x+5*u,y+18*u,1.2*u,color);line([x+12*u,y+6*u],[x+19*u,y+6*u],color,1.4);line([x+12*u,y+18*u],[x+19*u,y+18*u],color,1.4);}
    else if(name==='jobs'){[4,12,20].forEach(function(v){rect(x+2*u,y+(v-2)*u,4*u,4*u,null,color,1);line([x+10*u,y+v*u],[x+22*u,y+v*u],color,1.6);});}
    else if(name==='settings'){circle(x+12*u,y+12*u,7*u,null,color);circle(x+12*u,y+12*u,2.6*u,null,color);for(var k=0;k<8;k++){var a=k*Math.PI/4;line([x+(12+8*Math.cos(a))*u,y+(12+8*Math.sin(a))*u],[x+(12+11*Math.cos(a))*u,y+(12+11*Math.sin(a))*u],color,1.7);}}
    else if(name==='up'||name==='down'){var d=name==='up'?-1:1;line([x+12*u,y+4*u],[x+12*u,y+20*u],color,1.8);poly(P(d<0?[[5,11],[12,4],[19,11]]:[[5,13],[12,20],[19,13]]),color,1.8,false);}
    else if(name==='check'){poly(P([[4,12],[10,18],[21,5]]),color,2,false);}
    else if(name==='shield'){poly(P([[12,2],[22,6],[20,16],[12,23],[4,16],[2,6]]),color,1.7,true);line([x+12*u,y+7*u],[x+12*u,y+13*u],color,1.7);circle(x+12*u,y+17*u,.9*u,color);}
    else if(name==='key'){circle(x+8*u,y+8*u,5*u,null,color);poly(P([[12,12],[22,22],[22,16],[18,16]]),color,1.7,false);}
    else if(name==='clock'){circle(x+12*u,y+12*u,9*u,null,color);poly(P([[12,6],[12,12],[17,15]]),color,1.7,false);}
    else if(name==='refresh'){poly(P([[20,8],[17,4],[9,3],[4,8],[4,16],[9,21],[17,20],[21,15]]),color,1.7,false);poly(P([[20,2],[20,8],[14,8]]),color,1.7,false);}
    else if(name==='plus'){line([x+12*u,y+4*u],[x+12*u,y+20*u],color,1.7);line([x+4*u,y+12*u],[x+20*u,y+12*u],color,1.7);}
    else if(name==='search'){circle(x+10*u,y+10*u,6*u,null,color);line([x+15*u,y+15*u],[x+22*u,y+22*u],color,1.7);}
    else if(name==='warning'){poly(P([[12,2],[23,22],[1,22]]),color,1.7,true);line([x+12*u,y+8*u],[x+12*u,y+14*u],color,1.8);circle(x+12*u,y+18*u,.9*u,color);}
  }
  function cursor(x,y){poly([[x+1,y+2],[x+1,y+25],[x+7,y+19],[x+13,y+30],[x+17,y+28],[x+11,y+17],[x+20,y+16]],'#FFFFFF',2,true,'#17313B');}
  function shell(active,status){
    status=status||{server:'production-01',state:'연결됨 · SSH 응답 84 ms',tone:'connected'};
    rect(0,0,W,H,C.bg);rect(0,0,88,H,C.rail);rect(88,0,1512,56,C.paper);line([88,56],[1600,56],C.border);
    circle(22,28,5,'#EC786F');circle(42,28,5,'#E4BF68');circle(62,28,5,'#79BFA2');
    txt('sshOS',114,13,23,C.ink,true);line([204,17],[204,39],C.border);txt('시오스',222,18,14,C.muted);
    icon('desktop',341,19,18,C.muted);txt('열린 창 4',369,17,13,C.muted);txt('README.md',486,17,13,C.muted);txt('preview.png',604,17,13,C.muted);txt('터미널',730,17,13,C.muted);txt('report-worker',824,17,13,C.muted);
    var nodes=[['데스크톱','desktop',100],['연결','server',188],['파일','folder',276],['작업','jobs',364],['설정','settings',802]];
    nodes.forEach(function(a){var on=a[0]===active;if(on){rect(12,a[2]-13,64,71,C.navActive,null,10);rect(0,a[2]+4,3,29,'#78CFC3',null,1.5);}icon(a[1],32,a[2],24,on?'#E7FFFA':'#A3BBC1');center(a[0],12,a[2]+32,64,a[0]==='데스크톱'?11.5:13,on?'#FFFFFF':'#B5C8CE',on);});
    center('시오스',10,967,68,11,'#829FA7',false);
    var tint=status.tone==='pending'?C.amberPale:status.tone==='idle'?'#E9EFF2':C.mint;
    var tone=status.tone==='pending'?C.amber:status.tone==='idle'?C.muted:C.teal;
    rect(1236,9,340,38,tint,null,8);circle(1252,28,3.5,tone);txt(status.server,1264,12,13,C.ink,true);txt(status.state,1264,29,11.5,tone);chevron(1551,25,tone,true);
    rect(88,888,1512,112,C.white);line([88,888],[1600,888],C.border);
  }
  function shelf(){
    txt('전송 작업',112,905,16,C.ink,true);txt('진행 2 · 대기 0',112,936,12,C.muted);txt('파일 실행 1 · 터미널 1',112,958,11,C.teal);
    line([248,907],[248,982],C.border);rect(270,909,32,32,C.mint,null,8);icon('up',278,917,16,C.teal);
    txt('release-assets.zip',316,902,15,C.ink,true);txt('production-01 · 업로드',316,927,12,C.muted);txt('348 / 512 MiB · 전송 중 68%',316,952,12,C.teal,true);txt('12.4 MiB/s',738,952,12,C.muted);progress(316,978,510,68,C.teal);
    line([870,907],[870,982],C.border);rect(895,909,32,32,C.bluePale,null,8);icon('down',903,917,16,C.blue);
    txt('backup-2026-11-15.tar.gz',942,902,15,C.ink,true);txt('archive-01 · 다운로드 · 16 GiB',942,927,12,C.muted);
    txt('전송 16 / 16 GiB · 내용 확인 6.88 / 16 GiB (43%)',942,952,12,C.blue,true);txt('검증 128 MiB/s',1430,952,12,C.muted);progress(942,978,619,43,C.blue);
  }
  function field(label,value,x,y,w,mono){txt(label,x,y,13,C.muted,true);rect(x,y+26,w,44,C.white,C.border,7);txt(value,x+14,y+38,15,C.ink,false,w-28,mono);}
  function win(x,y,w,h,title,subtitle,kind,active){
    rect(x+4,y+8,w,h,'#CDDBDE',null,12);rect(x,y,w,h,C.white,active?'#86B9B0':'#C6D8DC',11);
    rect(x+1,y+1,w-2,44,active?'#F1F8F6':'#F7FAFB',null,10);line([x,y+45],[x+w,y+45],C.border);
    icon(kind||'file',x+16,y+14,18,active?C.teal:C.muted);txt(title,x+47,y+12,15,C.ink,true,w-160);
    line([x+w-85,y+23],[x+w-75,y+23],C.muted,1.2);rect(x+w-58,y+18,10,10,null,C.muted,1);line([x+w-29,y+18],[x+w-19,y+28],C.muted,1.2);line([x+w-19,y+18],[x+w-29,y+28],C.muted,1.2);
    txt(subtitle,x+17,y+57,11.5,C.muted,false,w-34);line([x+1,y+84],[x+w-1,y+84],'#E6EDF0');
  }
  var scenes={};
  ['scene-desktop.js','scene-connections-settings.js','scene-files-tasks.js'].forEach(function(name){
    var source=$.NSString.stringWithContentsOfFileEncodingError($(out+'/'+name),$.NSUTF8StringEncoding,null);
    if(!source)throw new Error('Missing owned scene module '+name);
    var renderModule=Function('scenes','C','shell','shelf','rect','txt','line','icon','button','badge','cursor','field','progress','circle','poly','center','chevron','win',ObjC.unwrap(source));
    renderModule(scenes,C,shell,shelf,rect,txt,line,icon,button,badge,cursor,field,progress,circle,poly,center,chevron,win);
  });
  var order=['01-desktop','02-connections','03-files','04-tasks','05-settings'];var report=[];
  order.forEach(function(id){
    if(typeof scenes[id]!=='function')throw new Error('Missing scene '+id);
    bitmap=$.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null,W*S,H*S,8,4,true,false,$.NSDeviceRGBColorSpace,0,0);
    $.NSGraphicsContext.saveGraphicsState;$.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap));$.NSGraphicsContext.currentContext.setShouldAntialias(true);
    var transform=$.NSAffineTransform.transform;transform.scaleBy(S);transform.concat;
    svg=['<svg xmlns="http://www.w3.org/2000/svg" width="3200" height="2000" viewBox="0 0 1600 1000"><title>sshOS(시오스) 메뉴별 예상 화면 '+id+'</title><desc>최근 논의한 기능을 포함한 검토용 UI 시안. 실제 앱 캡처와 승인된 개발 명세가 아님.</desc>'];overflow=[];scenes[id]();svg.push('</svg>');$.NSGraphicsContext.restoreGraphicsState;
    if(overflow.length)throw new Error('Text outside canvas: '+overflow.join(', '));
    var base=out+'/sshOS-preview-'+id;
    if(!$(svg.join('\n')+'\n').writeToFileAtomicallyEncodingError($(base+'.svg'),true,$.NSUTF8StringEncoding,null))throw new Error('SVG write failed');
    var png=bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$.NSDictionary.dictionary);if(!png.writeToFileAtomically($(base+'.png'),true))throw new Error('PNG write failed');
    report.push(id+': PNG + SVG 3200x2000');
  });
  return report.join('\n');
}
