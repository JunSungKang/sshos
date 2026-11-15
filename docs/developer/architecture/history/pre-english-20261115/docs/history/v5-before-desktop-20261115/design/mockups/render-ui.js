/* Design-only screenshot renderer. No app, network, or SSH implementation. */
ObjC.import('AppKit');
ObjC.import('Foundation');

function run(argv) {
  var allowed='/Users/kkkk/Desktop/jskang/03.workspace/01.project/sshOS';
  if (argv.length!==1) throw new Error('Pass the authorized project root.');
  var root=ObjC.unwrap($(argv[0]).stringByStandardizingPath.stringByResolvingSymlinksInPath);
  if(root!==allowed) throw new Error('Unauthorized output root');
  var out=root+'/design/mockups';
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
    if(name==='home'){poly(P([[2,10],[12,2],[22,10]]),color,1.7,false);poly(P([[5,9],[5,22],[10,22],[10,15],[15,15],[15,22],[20,22],[20,9]]),color,1.7,false);}
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
  function shell(active,phase){
    rect(0,0,W,H,C.bg);rect(0,0,88,H,C.rail);rect(88,0,1512,56,C.paper);line([88,56],[1600,56],C.border,1);
    circle(22,28,5,'#EC786F');circle(42,28,5,'#E4BF68');circle(62,28,5,'#79BFA2');
    txt('sshOS',114,13,23,C.ink,true);line([204,17],[204,39],C.border);txt('시오스',222,18,14,C.muted);
    var nodes=[['홈','home',100],['연결','server',188],['파일','folder',276],['작업','jobs',364],['설정','settings',802]];
    nodes.forEach(function(a){var on=a[0]===active;if(on){rect(12,a[2]-13,64,71,C.navActive,null,10);rect(0,a[2]+4,3,29,'#78CFC3',null,1.5);}icon(a[1],32,a[2],24,on?'#E7FFFA':'#A3BBC1');center(a[0],12,a[2]+32,64,13,on?'#FFFFFF':'#B5C8CE',on);});
    center('0.1.0',10,966,68,11,'#829FA7',false);
    rect(1236,9,340,38,phase===1?C.amberPale:phase===3?C.redPale:C.mint,null,8);
    circle(1252,28,3.5,phase===1?C.amber:phase===3?C.red:C.teal);
    txt('production-01',1264,12,13,C.ink,true);
    txt(phase===1?'호스트 확인 필요':phase===3?'연결 끊김':'연결됨 · SSH 응답 84 ms',1264,29,11.5,phase===1?C.amber:phase===3?C.red:C.teal);
    rect(88,888,1512,112,C.white);line([88,888],[1600,888],C.border);
  }
  function shelf(mode){
    txt('전송 작업',112,906,16,C.ink,true);
    txt(mode===1?'진행 0':mode===2?'진행 2 · 대기 0':'진행 1',112,936,13,C.muted);
    if(mode===3)txt('확인 필요 1',112,957,12,C.amber,true);
    if(mode===1){icon('folder',296,924,29,C.faint);txt('진행 중인 작업이 없습니다.',344,922,16,C.muted);txt('서버에 연결하면 파일을 업로드하거나 다운로드할 수 있습니다.',344,949,13,C.faint);return;}
    line([248,907],[248,982],C.border);
    rect(270,908,32,32,mode===3?C.amberPale:C.mint,null,8);icon(mode===3?'warning':'up',278,916,16,mode===3?C.amber:C.teal);
    txt('release-assets.zip',316,901,15,C.ink,true);txt('production-01 · 업로드',316,926,12,C.muted);
    if(mode===2){txt('348 / 512 MiB · 전송 중 68%',316,951,12,C.teal,true);txt('12.4 MiB/s',738,951,12,C.muted);progress(316,978,510,68,C.teal);}
    else {txt('결과 확인 필요',316,951,13,C.amber,true);txt('최종 파일 생성 응답 미확인',452,952,12,C.muted);}
    line([870,907],[870,982],C.border);
    rect(895,908,32,32,C.bluePale,null,8);icon('down',903,916,16,C.blue);
    txt('backup-2026-11-14.tar.gz',942,901,15,C.ink,true);txt('archive-01 · 다운로드 · 16 GiB',942,926,12,C.muted);
    txt('전송 16 / 16 GiB · 내용 확인 '+(mode===2?'6.88':'12.64')+' / 16 GiB ('+(mode===2?'43':'79')+'%)',942,951,12,C.blue,true);txt('검증 128 MiB/s',1430,951,12,C.muted);
    progress(942,978,619,mode===2?43:79,C.blue);
  }
  function field(label,value,x,y,w,mono){txt(label,x,y,13,C.muted,true);rect(x,y+26,w,44,C.white,C.border,7);txt(value,x+14,y+38,15,C.ink,false,w-28,mono);}
  function serverCard(name,desc,y,selected,status){
    rect(132,y,248,93,selected?C.white:'#EEF3F5',selected?'#91BFB8':null,9);
    icon('server',148,y+18,22,selected?C.teal:C.muted);txt(name,184,y+15,15,C.ink,true);
    txt(desc,184,y+41,12,C.muted);circle(189,y+72,3,status==='pending'?C.amber:'#A5B5BB');txt(status==='pending'?'호스트 확인 필요':'연결 안 됨',200,y+62,12,status==='pending'?C.amber:C.muted);
  }
  function sceneConnect(){
    shell('연결',1);rect(112,80,288,784,'#EFF4F6',C.border,12);
    txt('내 서버',132,106,21,C.ink,true);badge('3',216,109,28,C.muted,'#DFE8EC');icon('plus',352,110,20,C.muted);
    serverCard('production-01','203.0.113.24 : 22',162,true,'pending');serverCard('archive-01','백업 파일 서버',268,false);serverCard('staging-01','테스트 서버',374,false);
    txt('등록한 연결은 이 PC에 저장됩니다.',132,809,12,C.muted);
    rect(420,80,1156,784,C.paper,C.border,12);txt('서버 연결',452,108,28,C.ink,true);txt('연결할 서버와 인증 정보를 확인하세요.',452,153,15,C.muted);
    rect(452,194,490,44,'#E7EEF0',null,8);rect(456,198,237,36,C.white,null,6);center('SSH 개인키',456,207,237,14,C.teal,true);center('비밀번호',696,207,242,14,C.muted,false);
    field('연결 이름','production-01',452,264,490,false);
    field('서버 주소','203.0.113.24',452,358,354,true);field('포트','22',824,358,118,true);
    field('사용자 이름','ubuntu',452,452,490,true);
    txt('개인키 파일',452,546,13,C.muted,true);rect(452,572,490,50,C.white,C.border,7);icon('key',468,586,21,C.muted);txt('production_ed25519',500,587,14,C.ink,false,270,true);txt('파일 변경',855,588,12,C.teal,true);
    rect(453,652,17,17,C.white,C.border,3);txt('비밀번호·개인키 암호 저장',481,649,14,C.ink);txt('선택한 경우에만 이 PC에 암호화하여 저장합니다.',452,683,12,C.muted);
    button('호스트 확인 대기',452,756,490,'disabled');
    rect(982,194,552,602,C.white,'#B6D1CB',12);rect(1008,222,52,52,C.mint,null,12);icon('shield',1021,235,26,C.teal);
    txt('처음 연결하는 서버입니다.',1008,296,23,C.ink,true);txt('호스트 지문을 확인한 후 연결을 승인하세요.',1008,338,15,C.muted);
    line([1008,381],[1508,381],C.border);
    txt('연결 대상',1008,406,12,C.muted,true);txt('production-01',1008,432,18,C.ink,true);txt('203.0.113.24 : 22',1008,464,14,C.muted,false,480,true);
    txt('호스트 키 · ED25519',1008,512,12,C.muted,true);rect(1008,540,500,70,'#F2F6F7',null,7);
    txt('SHA256:',1022,549,12,C.muted,true,null,true);txt('vR8r7Q2KpL4eTs9mNc6UjW1bH0xF5dY3oAqZsGkIuE8',1022,575,12.3,C.ink,false,474,true);
    txt('서버 관리자가 제공한 지문과 비교하세요.',1008,636,14,C.ink);txt('승인 전에는 인증 정보를 서버에 보내지 않습니다.',1008,664,12,C.muted);
    button('취소',1008,722,112,'normal');button('승인하고 연결',1136,722,372,'primary');cursor(1379,746);
    shelf(1);
  }
  function treeRow(label,y,depth,on,open,folder){var x=132+depth*18;if(on)rect(122,y-6,230,36,'#DCEFEB',null,6);if(folder!==false){chevron(x,y+7,C.muted,!!open);icon('folder',x+20,y+1,18,on?C.teal:C.muted);txt(label,x+47,y,14,on?C.teal:C.ink,on);}else txt(label,x+20,y,14,C.ink);}
  function sceneFiles(){
    shell('파일',2);rect(112,80,1464,784,C.paper,C.border,12);rect(113,81,254,782,'#F0F5F6',null,11);line([367,81],[367,864],C.border);
    txt('파일',132,105,23,C.ink,true);icon('refresh',319,110,18,C.muted);
    icon('server',134,164,21,C.teal);txt('production-01',167,163,15,C.ink,true);circle(340,174,3.5,C.teal);
    txt('Ubuntu Server 24.04 LTS',135,196,12,C.muted);
    treeRow('home',244,0,false,true);treeRow('ubuntu',284,1,false,true);treeRow('uploads',324,2,true,false);treeRow('documents',364,2,false,false);treeRow('media',404,2,false,false);treeRow('public',444,2,false,false);treeRow('var',498,0,false,false);treeRow('etc',538,0,false,false);
    line([132,603],[348,603],C.border);txt('다른 서버',132,625,12,C.muted,true);icon('server',134,662,20,C.muted);txt('archive-01',167,662,14,C.ink);circle(338,673,3,C.teal);
    txt('숨김 파일 표시',135,817,12,C.muted);rect(308,817,36,19,C.teal,null,10);circle(334,826.5,6.5,C.white);
    rect(386,94,278,42,C.white,C.border,7);icon('folder',400,107,17,C.teal);txt('production-01 / uploads',429,106,14,C.ink,true);txt('×',640,104,18,C.muted);
    txt('archive-01 / backups',692,106,14,C.muted);txt('×',892,104,18,C.muted);icon('plus',937,108,18,C.muted);line([386,143],[1555,143],C.border);
    button('업로드',392,162,120,'primary','up');button('다운로드',524,162,132,'normal','down');button('새 폴더',668,162,120,'normal','plus');button('이름 변경',800,162,112,'normal');button('삭제',924,162,72,'normal');
    rect(1230,162,326,40,C.white,C.border,7);icon('search',1243,173,17,C.faint);txt('현재 폴더에서 이름 찾기',1270,173,13,C.faint);
    icon('folder',395,225,20,C.muted);txt('home',426,225,14,C.muted);chevron(480,231,C.faint,false);txt('ubuntu',506,225,14,C.muted);chevron(574,231,C.faint,false);txt('uploads',600,225,14,C.ink,true);icon('refresh',1533,226,18,C.muted);
    rect(386,268,1170,38,'#EDF2F4',null,5);txt('이름',430,279,12,C.muted,true);chevron(478,285,C.muted,false);txt('종류',986,279,12,C.muted,true);txt('크기',1130,279,12,C.muted,true);txt('수정한 날짜',1280,279,12,C.muted,true);
    var rows=[['incoming','폴더','—','2026. 11. 14. 18:32',true],['images','폴더','—','2026. 11. 14. 17:50',true],['README.txt','텍스트 파일','6.2 KiB','2026. 11. 14. 18:15'],['server-notes.md','Markdown 파일','8.4 KiB','2026. 11. 14. 19:12'],['metrics-2026-11.csv','CSV 파일','12.6 MiB','2026. 11. 14. 18:45'],['access-2026-11-13.log','로그 파일','84.2 MiB','2026. 11. 14. 09:00'],['banner-final.png','PNG 이미지','2.8 MiB','2026. 11. 13. 16:26'],['.sshos-9b6f8a24-36e1-4b86-9d81-7b...part','임시 파일','348 MiB','2026. 11. 14. 19:41']];
    rows.forEach(function(a,i){var y=310+i*58;if(i===3)rect(386,y,1170,56,'#E4F2EE',null,5);else if(i%2===0)rect(386,y,1170,56,'#FFFFFF',null,3);icon(a[4]?'folder':'file',400,y+17,21,a[4]?'#B08B42':i===7?C.faint:i===3?C.teal:C.muted);txt(a[0],435,y+17,14,i===7?C.faint:C.ink,i===3,528,i===7);txt(a[1],986,y+18,13,i===7?C.faint:C.muted);txt(a[2],1130,y+18,13,i===7?C.faint:C.muted);txt(a[3],1280,y+18,13,i===7?C.faint:C.muted);});
    line([386,803],[1556,803],C.border);txt('8개 항목 · 1개 선택',392,823,12,C.muted);txt('/home/ubuntu/uploads',1230,823,12,C.muted,false,310,true);cursor(618,514);
    shelf(2);
  }
  function taskCard(y,selected,name,server,state,kind,percent){
    rect(132,y,392,136,selected?C.amberPale:C.white,selected?'#DEBE7D':C.border,9);if(selected)rect(132,y+12,3,111,'#BF8A31',null,1.5);
    icon(kind==='up'?'up':'down',149,y+20,20,selected?C.amber:C.blue);txt(name,182,y+17,15,C.ink,true,322);txt(server+' · '+(kind==='up'?'업로드':'다운로드'),150,y+52,12,C.muted);
    txt(state,150,y+82,14,selected?C.amber:C.blue,true);if(percent)progress(150,y+116,356,percent,C.blue);else txt('최종 파일 생성 응답 미확인',150,y+108,11,C.muted);
  }
  function sceneUnknown(){
    shell('작업',3);rect(112,80,432,784,C.paper,C.border,12);txt('작업',132,107,25,C.ink,true);txt('현재 작업과 최근 기록을 확인합니다.',132,149,13,C.muted);
    badge('전체 3',132,192,84,C.teal,C.mint);txt('진행 1',240,199,13,C.muted);txt('확인 필요 1',337,199,13,C.amber,true);
    taskCard(247,true,'release-assets.zip','production-01','결과 확인 필요','up');taskCard(399,false,'backup-2026-11-14.tar.gz','archive-01','내용 확인 12.64 / 16 GiB · 79%','down',79);
    txt('최근 완료',132,571,12,C.muted,true);rect(132,603,392,102,C.white,C.border,9);circle(160,631,11,C.mint);icon('check',153,624,14,C.teal);txt('server-notes.md',183,617,15,C.ink,true);txt('production-01 · 다운로드',150,654,12,C.muted);txt('완료 · 19:38',394,654,12,C.teal);
    txt('확인되지 않은 결과는 완료로 표시하지 않습니다.',132,815,11.5,C.muted);
    rect(564,80,1012,784,C.white,C.border,12);txt('업로드  /  production-01',596,108,13,C.muted);txt('release-assets.zip',596,141,29,C.ink,true);badge('결과 확인 필요',1392,142,150,C.amber,C.amberPale);txt('512 MiB · /home/ubuntu/uploads',596,189,14,C.muted);
    var steps=[['전송 완료','512 / 512 MiB',C.teal],['내용 확인 완료','파일 내용 일치',C.teal],['최종 파일 생성','응답 확인 못함',C.amber],['결과 확인 대기','다시 연결 후 확인',C.faint]];
    steps.forEach(function(a,i){var x=612+i*236;if(i<3)line([x+17,265],[x+220,265],i<1?'#A8CEC5':'#DDE5E8',2);circle(x,265,11,i<2?C.mint:i===2?C.amberPale:'#F0F3F4');if(i<2)icon('check',x-7,258,14,C.teal);else if(i===2)txt('!',x-2,255,16,C.amber,true);else circle(x,265,3,C.faint);txt(a[0],x-8,289,15,a[2],true);txt(a[1],x-8,316,12,C.muted);});
    rect(596,368,948,144,C.amberPale,'#EDDCB7',9);icon('warning',618,393,23,C.amber);txt('최종 파일 생성 응답을 받지 못했습니다.',657,391,20,C.ink,true);
    txt('전송과 내용 확인은 끝났지만, 파일 생성 결과는 확인되지 않았습니다.',618,436,15,C.ink);txt('다시 연결한 뒤 대상 폴더를 확인하세요. 자동으로 다시 전송하지 않습니다.',618,471,14,C.muted);
    var details=[['연결 대상','production-01 · 203.0.113.24:22'],['예정된 대상 경로','/home/ubuntu/uploads/release-assets.zip'],['마지막 확인','내용 확인 완료 · 19:42:10']];
    details.forEach(function(a,i){var y=545+i*51;txt(a[0],599,y,13,C.muted);txt(a[1],790,y,14,C.ink,false,735,i===1);if(i<2)line([596,y+35],[1544,y+35],'#EDF1F3');});
    button('다시 연결',596,726,158,'primary','refresh');button('위치 열기',766,726,132,'disabled');button('확인 후 기록 닫기',1320,726,224,'normal');cursor(714,750);
    circle(605,815,3,C.teal);txt('archive-01의 작업은 계속 진행 중입니다.',619,805,13,C.muted);shelf(3);
  }
  var scenes=[['01-connect',sceneConnect],['02-files-transfers',sceneFiles],['03-result-unknown',sceneUnknown]];
  var report=[];
  scenes.forEach(function(scene){
    bitmap=$.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null,W*S,H*S,8,4,true,false,$.NSDeviceRGBColorSpace,0,0);
    $.NSGraphicsContext.saveGraphicsState;$.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap));
    $.NSGraphicsContext.currentContext.setShouldAntialias(true);var transform=$.NSAffineTransform.transform;transform.scaleBy(S);transform.concat;
    svg=['<svg xmlns="http://www.w3.org/2000/svg" width="3200" height="2000" viewBox="0 0 1600 1000" role="img"><title>sshOS(시오스) 개발 완료 예상 화면 '+scene[0]+'</title><desc>v5 계획에 근거한 직접 렌더링 시안. 실제 앱 실행 캡처가 아닙니다.</desc>'];overflow=[];scene[1]();svg.push('</svg>');$.NSGraphicsContext.restoreGraphicsState;
    if(overflow.length)throw new Error('Canvas text overflow: '+overflow.join(', '));
    var base=out+'/sshOS-v5-'+scene[0];
    if(!$(svg.join('\n')+'\n').writeToFileAtomicallyEncodingError($(base+'.svg'),true,$.NSUTF8StringEncoding,null))throw new Error('SVG write failed');
    var png=bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$.NSDictionary.dictionary);if(!png.writeToFileAtomically($(base+'.png'),true))throw new Error('PNG write failed');
    report.push(scene[0]+': 3200x2000 PNG + SVG');
  });
  return report.join('\n');
}
