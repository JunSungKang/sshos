/* Design-only screenshot renderer. No app, network, or SSH implementation. */
ObjC.import('AppKit');
ObjC.import('Foundation');
ObjC.import('ImageIO');

function run(argv) {
  var allowed='/Users/kkkk/Desktop/jskang/03.workspace/01.project/sshOS';
  if (argv.length!==1) throw new Error('Pass the authorized project root.');
  var root=ObjC.unwrap($(argv[0]).stringByStandardizingPath.stringByResolvingSymlinksInPath);
  if(root!==allowed) throw new Error('Unauthorized output root');
  var out=root+'/design/mockups/desktop-motion-20261115';
  if(ObjC.unwrap($(out).stringByResolvingSymlinksInPath)!==out) throw new Error('Symlink output is not allowed');
  var W=1600,H=1000,S=1;
  var C={bg:'#DCE7EB',rail:'#102D35',paper:'#F8FAFB',white:'#FFFFFF',ink:'#16313B',muted:'#667D86',faint:'#8B9EA5',border:'#D6E1E5',teal:'#087F78',tealDark:'#086B65',mint:'#E9F5F2',navActive:'#1E5157',blue:'#3868AD',bluePale:'#EDF3FC',amber:'#9C6817',amberPale:'#FFF5E2',red:'#A84B47',redPale:'#FAEFED'};
  var bitmap,svg={push:function(){}},overflow=[];
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
  function mix(a,b,p){return a+(b-a)*p;}
  function ease(p){p=Math.max(0,Math.min(1,p));return p*p*(3-2*p);}
  function caption(s,x,y,w){txt(s,x+1,y+1,13,'#17424B',true,w);center(s,x,y,w,13,'#F5FAF9',true);}
  function wallpaper(){
    for(var y=0;y<1000;y+=4){var p=y/1000;var rgb=[mix(15,37,p),mix(55,112,p),mix(67,112,p)].map(function(v){return Math.round(v).toString(16).padStart(2,'0');}).join('');rect(0,y,1600,4,'#'+rgb);}
    var q=$.NSBezierPath.bezierPath;q.moveToPoint($.NSMakePoint(1060,1000));q.curveToPointControlPoint1ControlPoint2($.NSMakePoint(1600,80),$.NSMakePoint(650,660),$.NSMakePoint(1200,200));q.lineToPoint($.NSMakePoint(1600,1000));q.closePath;col('#2B6D73').setFill;q.fill;
    var q2=$.NSBezierPath.bezierPath;q2.moveToPoint($.NSMakePoint(1600,890));q2.curveToPointControlPoint1ControlPoint2($.NSMakePoint(580,0),$.NSMakePoint(1380,540),$.NSMakePoint(1160,180));q2.lineToPoint($.NSMakePoint(1600,0));q2.closePath;col('#398181').setFill;q2.fill;
    var q3=$.NSBezierPath.bezierPath;q3.moveToPoint($.NSMakePoint(1600,230));q3.curveToPointControlPoint1ControlPoint2($.NSMakePoint(1150,0),$.NSMakePoint(1490,150),$.NSMakePoint(1360,30));q3.lineToPoint($.NSMakePoint(1600,0));q3.closePath;col('#4C9390').setFill;q3.fill;
    rect(0,0,1600,44,'#0D2933');txt('sshOS',22,9,21,'#F0FAF8',true);txt('시오스',105,15,12,'#B3CFD2');
    txt('데스크톱',198,13,13,'#D5E6E5',true);txt('2026. 11. 15.',750,14,12,'#AAC8CC');
    rect(1212,6,370,32,'#204C53',null,7);circle(1228,22,3.5,'#77D8BF');txt('production-01',1242,9,12,'#F0FAF8',true);txt('연결됨 · SSH 응답 84 ms',1381,10,11,'#A8E1D2');
    var apps=[['연결','server',91],['파일','folder',218],['터미널','terminal',345],['설정','settings',472]];
    apps.forEach(function(a){rect(51,a[2]+5,68,64,'#1C4C55',null,14);rect(48,a[2],68,64,'#E6F3F0',null,13);icon(a[1],65,a[2]+16,34,a[1]==='folder'?'#B58C3D':'#1D716D');center(a[0],27,a[2]+77,110,14,'#F1FAF7',true);});
  }
  function chrome(x,y,w,h,title,kind,dark,active){
    rect(x+3,y+9,w,h,'#254C55',null,10);rect(x+1,y+4,w,h,'#365D63',null,10);
    rect(x,y,w,h,dark?'#132D37':C.white,active?'#93CDBD':'#C8DBDC',9);
    rect(x+1,y+1,w-2,40,dark?'#203E48':active?'#F0F9F6':'#F7FAFB',null,9);
    line([x+1,y+41],[x+w-1,y+41],dark?'#35525A':'#DDE7E9');
    icon(kind,x+14,y+12,18,dark?'#A7D3CD':C.teal);txt(title,x+44,y+10,14,dark?'#E9F5F2':C.ink,true,w-174);
    var cc=dark?'#C1D7D9':C.muted;line([x+w-103,y+21],[x+w-91,y+21],cc,1.5);rect(x+w-70,y+16,11,10,null,cc,1);line([x+w-35,y+15],[x+w-24,y+26],cc,1.4);line([x+w-24,y+15],[x+w-35,y+26],cc,1.4);
  }
  function explorer(){
    var x=220,y=158,w=940,h=596;chrome(x,y,w,h,'파일 · production-01','folder',false,false);
    txt('‹',239,209,25,C.muted);txt('›',276,209,25,C.faint);txt('↑',314,211,20,C.muted);
    rect(354,209,600,33,'#F0F5F6',C.border,5);icon('folder',367,217,17,C.muted);txt('/home/ubuntu/workspace',395,217,13,C.ink,false,533,true);icon('refresh',976,216,18,C.muted);txt('더 보기',1069,217,12,C.muted,true);
    line([221,254],[1159,254],'#E2E9EA');rect(221,255,180,467,'#EFF5F6');
    txt('production-01',238,274,13,C.ink,true);txt('Ubuntu 24.04 LTS',238,300,11,C.muted);
    var tree=[['home',0,351],['ubuntu',1,390],['workspace',2,429],['assets',3,468],['var',0,526],['etc',0,565]];
    tree.forEach(function(a){var tx=235+a[1]*15;if(a[0]==='workspace')rect(230,a[2]-8,162,34,'#D8ECE6',null,5);icon('folder',tx,a[2],16,a[0]==='workspace'?C.teal:C.muted);txt(a[0],tx+24,a[2]-2,12,a[0]==='workspace'?C.teal:C.ink,a[0]==='workspace',145-a[1]*15);});
    rect(416,267,727,33,'#F0F5F6',null,4);txt('이름',455,276,12,C.muted,true);txt('종류',797,276,12,C.muted,true);txt('크기',1003,276,12,C.muted,true);
    var rows=[['assets','폴더','—','folder'],['README.md','텍스트','6.2 KiB','file'],['preview.png','PNG 이미지','2.8 MiB','image'],['check-assets.sh','셸 스크립트','3.4 KiB','terminal'],['report-worker','실행 파일','8.6 MiB','play'],['notes.txt','텍스트','148 B','file']];
    rows.forEach(function(a,i){var ry=311+i*56;if(i===2)rect(416,ry,727,52,'#DFF0E9',null,4);else if(i%2===0)rect(416,ry,727,52,'#FAFCFC',null,3);icon(a[3],430,ry+15,20,i===2?C.teal:C.muted);txt(a[0],461,ry+15,14,C.ink,i===2,322);txt(a[1],797,ry+16,12,C.muted);txt(a[2],1003,ry+16,12,C.muted);});
    line([221,721],[1159,721],'#DDE7E9');txt('6개 항목 · preview.png 선택됨',238,733,11,C.muted);txt('마지막 조회 09:42:18',1008,733,11,C.muted);
  }
  function terminal(){
    var x=530,y=571,w=840,h=284;chrome(x,y,w,h,'터미널 · production-01','terminal',true,false);
    txt('ubuntu · /home/ubuntu/workspace',548,624,11,'#93B6BC');
    var lines=[['ubuntu@production-01:~/workspace$ ./report-worker --input ./assets','#E0EFEB'],['[09:42:12] Scanning 183 files','#8BCBB7'],['[09:42:13] report.json created','#8BCBB7'],['ubuntu@production-01:~/workspace$','#D8EAE6']];
    lines.forEach(function(a,i){txt(a[0],550,657+i*34,13,a[1],false,802,true);});rect(801,760,8,17,'#8BCBB7');
    line([531,815],[1369,815],'#34515A');circle(550,835,3,'#84CCB7');txt('SSH 연결됨',562,826,11,'#A7CFC9');txt('키보드 입력 가능',1238,826,11,'#A7CFC9');
  }
  function imageWindow(){
    var x=0,y=0,w=650,h=420;chrome(x,y,w,h,'preview.png · production-01','image',false,true);
    txt('/home/ubuntu/workspace/preview.png',18,53,11,C.muted,false,610,true);
    var ix=19,iy=86,iw=612,ih=268;rect(ix,iy,iw,ih,'#D3E6E3',null,2);
    circle(ix+485,iy+51,23,'#FAF1D2');
    poly([[ix,iy+152],[ix+82,iy+82],[ix+175,iy+148],[ix+298,iy+44],[ix+405,iy+153],[ix+524,iy+83],[ix+612,iy+140],[ix+612,iy+207],[ix,iy+207]],null,1,true,'#91B3B3');
    poly([[ix+235,iy+100],[ix+298,iy+44],[ix+357,iy+104],[ix+322,iy+89],[ix+302,iy+93],[ix+283,iy+79]],null,1,true,'#EEF5EF');
    poly([[ix,iy+178],[ix+77,iy+142],[ix+170,iy+191],[ix+235,iy+131],[ix+356,iy+188],[ix+464,iy+135],[ix+612,iy+189],[ix+612,iy+229],[ix,iy+229]],null,1,true,'#538587');
    rect(ix,iy+205,iw,63,'#8EBAB6');
    for(var j=0;j<11;j++)line([ix+100+j*12,iy+212+j*4],[ix+iw-70-j*19,iy+212+j*4],j%2?'#B1CFCA':'#77A5A2',1);
    poly([[ix,iy+206],[ix+72,iy+181],[ix+135,iy+229],[ix+167,iy+268],[ix,iy+268]],null,1,true,'#245D60');
    poly([[ix+483,iy+268],[ix+535,iy+225],[ix+612,iy+199],[ix+612,iy+268]],null,1,true,'#245D60');
    for(var k=0;k<8;k++){var tx=ix+12+k*11,ty=iy+190+k*3;poly([[tx,ty-35],[tx-11,ty+3],[tx+11,ty+3]],null,1,true,'#245D60');}
    line([1,372],[649,372],'#E0E9E9');txt('1920 × 840 · 2.8 MiB',18,389,11,C.muted);rect(389,382,96,28,'#EDF5F2',null,5);center('화면 맞춤',389,389,96,11,C.teal,true);txt('−',512,383,21,C.muted);txt('32%',547,390,11,C.ink);txt('+',606,384,20,C.muted);
  }
  function floating(x,y,scale){
    if(scale<0.005)return;
    $.NSGraphicsContext.saveGraphicsState;var tr=$.NSAffineTransform.transform;tr.translateXByYBy(x,H-y);tr.scaleBy(scale);tr.translateXByYBy(0,-H);tr.concat;imageWindow();$.NSGraphicsContext.restoreGraphicsState;
  }
  function lowerBar(minimized,t){
    rect(0,884,1600,60,'#13343E');line([0,884],[1600,884],'#426B70');txt('전송 2',22,900,13,'#D8ECE7',true);
    icon('up',135,901,19,'#8ED8C0');txt('release-assets.zip · production-01',168,895,12,'#ECF5F1',true);txt('348 / 512 MiB · 68%',168,918,11,'#A2C9C5');progress(431,912,257,68,'#77CDB5');
    line([738,896],[738,931],'#41676D');icon('down',768,901,19,'#9DC8E9');txt('backup.tar.gz · archive-01',802,895,12,'#ECF5F1',true);txt('전송 16 / 16 GiB · 내용 확인 43%',802,918,11,'#A2C9C5');progress(1128,912,244,43,'#86B2D4');txt('전체 작업',1488,904,12,'#D8ECE7',true);
    rect(0,944,1600,56,'#0B252F');
    for(var row=0;row<2;row++)for(var coln=0;coln<2;coln++)rect(25+coln*11,961+row*11,8,8,'#A4DCCD',null,1);
    rect(83,952,200,40,'#183C46',null,6);icon('folder',97,962,20,'#D9C486');txt('파일 · production-01',127,963,12,'#D8EAE5',true);rect(166,992,32,3,'#76BEAE',null,1.5);
    rect(295,952,190,40,minimized?'#13313C':'#2A5B60',null,6);icon('image',309,962,20,'#9AD9C5');txt('preview.png',340,963,13,'#F2F9F6',true);if(!minimized)rect(373,992,33,3,'#8BE6C7',null,1.5);else circle(390,994,2,'#88B8AC');
    rect(497,952,213,40,'#183C46',null,6);icon('terminal',510,962,20,'#B2D6D2');txt('터미널 · production-01',542,963,12,'#D8EAE5',true);rect(586,992,32,3,'#76BEAE',null,1.5);
    icon('settings',744,962,20,'#B4CFD0');circle(1350,974,3,'#7CCEAE');txt('연결 2',1362,964,12,'#C7E1DB');txt('09:42',1463,950,14,'#ECF6F2',true);txt('2026. 11. 15.',1451,976,10,'#AAC8C7');
  }
  function frameState(t){
    var initial={x:720,y:126},target={x:880,y:240},x=initial.x,y=initial.y,s=1,cx=x+180,cy=y+21,minimized=false;
    if(t>=0.3&&t<1.1){var p=ease((t-.3)/.8);x=mix(initial.x,target.x,p);y=mix(initial.y,target.y,p);cx=x+180;cy=y+21;}
    else if(t>=1.1&&t<1.4){x=target.x;y=target.y;var p=ease((t-1.1)/.3);cx=mix(x+180,x+553,p);cy=y+21;}
    else if(t>=1.4&&t<1.75){var p=ease((t-1.4)/.35);s=mix(1,.018,p);x=mix(target.x,383,p);y=mix(target.y,970,p);cx=target.x+553;cy=target.y+21;minimized=p>.5;}
    else if(t>=1.75&&t<2.05){s=0;minimized=true;var p=ease((t-1.75)/.3);cx=mix(target.x+553,390,p);cy=mix(target.y+21,971,p);}
    else if(t>=2.05&&t<2.35){var p=ease((t-2.05)/.3);s=mix(.018,1,p);x=mix(383,target.x,p);y=mix(970,target.y,p);cx=390;cy=971;minimized=p<.5;}
    else if(t>=2.35&&t<2.6){x=target.x;y=target.y;var p=ease((t-2.35)/.25);cx=mix(390,x+180,p);cy=mix(971,y+21,p);}
    else if(t>=2.6&&t<3.45){var p=ease((t-2.6)/.85);x=mix(target.x,initial.x,p);y=mix(target.y,initial.y,p);cx=x+180;cy=y+21;}
    return {x:x,y:y,scale:s,cx:cx,cy:cy,minimized:minimized};
  }
  function scene(t){
    wallpaper();explorer();terminal();var f=frameState(t);floating(f.x,f.y,f.scale);lowerBar(f.minimized,t);
    [.3,1.4,2.05,2.6].forEach(function(c){var dt=t-c;if(dt>=0&&dt<.2)circle(f.cx+4,f.cy+5,10+dt*25,null,'#A6F1DA');});cursor(f.cx,f.cy);
  }
  function draw(t,scale){
    bitmap=$.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null,W*scale,H*scale,8,4,true,false,$.NSDeviceRGBColorSpace,0,0);
    $.NSGraphicsContext.saveGraphicsState;$.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap));$.NSGraphicsContext.currentContext.setShouldAntialias(true);var tr=$.NSAffineTransform.transform;tr.scaleBy(scale);tr.concat;overflow=[];scene(t);$.NSGraphicsContext.restoreGraphicsState;
    if(overflow.length)throw new Error('Text overflow: '+overflow.join(', '));return bitmap;
  }
  var count=80,delay=.05;
  var gif=$.CGImageDestinationCreateWithURL($.NSURL.fileURLWithPath($(out+'/sshOS-desktop-motion.gif')),$('com.compuserve.gif'),count,null);
  if(!gif)throw new Error('Could not create GIF destination');
  $.CGImageDestinationSetProperties(gif,$({'{GIF}':{'LoopCount':0}}));
  for(var i=0;i<count;i++){
    var b=draw(i*delay,1);
    $.CGImageDestinationAddImage(gif,b.CGImage,$({'{GIF}':{'DelayTime':delay,'UnclampedDelayTime':delay}}));
  }
  if(!$.CGImageDestinationFinalize(gif))throw new Error('GIF finalization failed');
  var poster=draw(1.1,2).representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$.NSDictionary.dictionary);
  if(!poster.writeToFileAtomically($(out+'/sshOS-desktop-poster.png'),true))throw new Error('Poster write failed');
  return '4.00-second GIF: 80 frames at 20 fps, 1600x1000. Poster: 3200x2000.';
}
