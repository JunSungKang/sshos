/*
 * sshOS v4 architecture artifact renderer; this is not application code.
 * macOS built-ins only. Run from the project root:
 *   osascript -l JavaScript design/architecture-render.js "$PWD"
 * The same drawing primitives produce the editable SVG and the PNG.
 */
ObjC.import('AppKit');
ObjC.import('Foundation');

function run(argv) {
  if (argv.length !== 1 || argv[0][0] !== '/') throw new Error('Pass the absolute project root.');
  var root = ObjC.unwrap($(argv[0]).stringByStandardizingPath.stringByResolvingSymlinksInPath);
  var allowed = '/Users/kkkk/Desktop/jskang/03.workspace/01.project/sshOS';
  if (root !== allowed) throw new Error('Output root is not the authorized workspace.');
  var fm = $.NSFileManager.defaultManager;
  var design = root + '/design';
  if (!fm.fileExistsAtPath($(design))) throw new Error('The design directory must already exist.');
  var designReal = ObjC.unwrap($(design).stringByResolvingSymlinksInPath);
  if (designReal !== design) throw new Error('The design directory must not be a symlink.');
  var W = 2000, H = 1260;
  var bitmap = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, W, H, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  var context = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext(context);
  context.setShouldAntialias(true);
  var C = { bg:'#F2F6F5', navy:'#102F39', ink:'#173A44', muted:'#526B73', teal:'#087F78', light:'#E4F2EE', border:'#C7DAD7', white:'#FFFFFF', pale:'#F7FAF9', line:'#769C99' };
  var svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-labelledby="title desc">',
    '<title id="title">sshOS(시오스) v4 시스템 아키텍처</title>',
    '<desc id="desc">프레임워크 결정 전 공통 구조. 사용자 PC의 GUI, 제한된 IPC 경계, 로컬 코어와 비동기 SSH·SFTP 엔진이 기존 Linux 서버에 직접 연결한다. 제품 구현 미착수. SSH 응답 84ms는 예시이며 실측값이 아니다.</desc>'];
  function esc(v) { return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function color(hex) { return $.NSColor.colorWithSRGBRedGreenBlueAlpha(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255,1); }
  function box(x,y,w,h,fill,stroke,r,sw) {
    r=r||0; sw=sw||1.5;
    var p = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius($.NSMakeRect(x,H-y-h,w,h),r,r);
    if (fill) { color(fill).setFill; p.fill; }
    if (stroke) { color(stroke).setStroke; p.setLineWidth(sw); p.stroke; }
    svg.push('<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+r+'" fill="'+(fill||'none')+'" stroke="'+(stroke||'none')+'" stroke-width="'+sw+'"/>');
  }
  function text(t,x,y,size,fill,bold) {
    var font = $.NSFont.fontWithNameSize($(bold?'AppleSDGothicNeo-Bold':'AppleSDGothicNeo-Regular'),size);
    if (!font) font=bold?$.NSFont.boldSystemFontOfSize(size):$.NSFont.systemFontOfSize(size);
    var attrs=$.NSMutableDictionary.alloc.init;
    attrs.setObjectForKey(font,$.NSFontAttributeName);
    attrs.setObjectForKey(color(fill||C.ink),$.NSForegroundColorAttributeName);
    $(t).drawAtPointWithAttributes($.NSMakePoint(x,H-y-size*1.23),attrs);
    svg.push('<text x="'+x+'" y="'+(y+size)+'" font-family="Apple SD Gothic Neo, AppleSDGothicNeo, sans-serif" font-size="'+size+'" font-weight="'+(bold?700:400)+'" fill="'+(fill||C.ink)+'">'+esc(t)+'</text>');
  }
  function path(points,stroke,width,arrow) {
    var p=$.NSBezierPath.bezierPath;
    p.moveToPoint($.NSMakePoint(points[0][0],H-points[0][1]));
    for (var i=1;i<points.length;i++) p.lineToPoint($.NSMakePoint(points[i][0],H-points[i][1]));
    p.setLineWidth(width||2); color(stroke||C.teal).setStroke; p.stroke;
    svg.push('<polyline points="'+points.map(function(a){return a.join(',');}).join(' ')+'" fill="none" stroke="'+(stroke||C.teal)+'" stroke-width="'+(width||2)+'" stroke-linejoin="round"/>');
    if (arrow) {
      var b=points[points.length-1], a=points[points.length-2], angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
      var n=11, spread=0.48;
      path([[b[0]-n*Math.cos(angle-spread),b[1]-n*Math.sin(angle-spread)],b,[b[0]-n*Math.cos(angle+spread),b[1]-n*Math.sin(angle+spread)]],stroke,width,false);
    }
  }
  function dot(x,y,r,fill) {
    var p=$.NSBezierPath.bezierPathWithOvalInRect($.NSMakeRect(x-r,H-y-r,2*r,2*r));
    color(fill).setFill; p.fill;
    svg.push('<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="'+fill+'"/>');
  }
  function iconWindow(x,y,s,stroke) {
    box(x,y,s,s*0.72,null,stroke,4,2); path([[x,y+s*.21],[x+s,y+s*.21]],stroke,2);
    dot(x+s*.12,y+s*.10,1.6,stroke); dot(x+s*.24,y+s*.10,1.6,stroke);
  }
  function iconServer(x,y,s,stroke) {
    box(x,y,s,s*.32,null,stroke,4,2); box(x,y+s*.44,s,s*.32,null,stroke,4,2);
    dot(x+s*.16,y+s*.16,2.2,stroke); dot(x+s*.16,y+s*.60,2.2,stroke);
    path([[x+s*.48,y+s*.16],[x+s*.82,y+s*.16]],stroke,2); path([[x+s*.48,y+s*.60],[x+s*.82,y+s*.60]],stroke,2);
  }
  function pill(label,x,y,w,active) {
    box(x,y,w,42,active?C.teal:C.pale,active?C.teal:C.border,12);
    text(label,x+20,y+7,21,active?C.white:C.ink,true);
  }
  function tag(n,x,y) { box(x,y,35,35,C.light,null,9); text(n,x+10,y+4,21,C.teal,true); }

  // Header and hierarchy.
  box(0,0,W,H,C.bg,null,0);
  box(60,53,8,56,C.teal,null,4);
  text('sshOS(시오스) v4 시스템 아키텍처',88,46,46,C.navy,true);
  text('내 PC에서 직접 SSH 연결 · 프레임워크 결정 전 공통 구조',88,111,26,C.muted,false);
  box(1516,64,424,59,C.navy,null,17);
  text('설계 v4  ·  제품 구현 미착수',1541,77,24,C.white,true);

  // Trust boundaries.
  box(60,190,1100,790,C.light,C.border,26,2);
  iconWindow(94,220,40,C.teal);
  text('사용자 PC',151,211,30,C.navy,true);
  text('macOS / Windows',790,220,23,C.muted,false);
  box(1390,190,550,790,C.white,C.border,26,2);
  iconServer(1424,220,40,C.teal);
  text('기존 Linux 서버',1480,211,30,C.navy,true);
  text('초기 지원: Ubuntu Server 24.04 LTS',1422,269,23,C.muted,false);

  // Renderer.
  box(92,282,1036,184,C.white,C.border,19);
  tag('1',118,307);
  text('OS형 GUI 작업 공간',166,302,29,C.navy,true);
  text('GUI · 화면과 사용자 조작',119,351,22,C.muted,false);
  box(752,304,347,75,C.pale,C.border,13);
  dot(777,326,5,C.teal); text('production-01',793,310,21,C.ink,true);
  text('SSH 응답  84 ms',773,342,22,C.teal,true);
  pill('홈',119,402,95,false); pill('연결',226,402,110,false);
  pill('파일',348,402,110,true); pill('작업',470,402,110,false); pill('설정',592,402,110,false);
  text('진행률은 화면을 바꿔도 유지',752,409,21,C.muted,false);

  // Narrow IPC bridge.
  path([[344,466],[344,500]],C.teal,3,true);
  box(92,500,1036,78,C.navy,null,17);
  text('2',122,516,25,C.white,true);
  text('제한된 IPC 경계',166,514,28,C.white,true);
  text('허용된 메시지 · 입력 검증 · 기능별 요청',617,520,22,'#C5E4DE',false);
  path([[344,578],[344,612]],C.teal,3,true);

  // Main and worker processes.
  box(92,612,500,302,C.white,C.border,19);
  tag('3',118,636); text('로컬 코어',166,632,29,C.navy,true);
  text('프로필 · 호스트 키 신뢰 관리',119,687,25,C.ink,true);
  text('OS 암호화 연계',119,730,24,C.ink,false);
  text('로컬 JSON 설정 · 기록',119,773,24,C.ink,false);
  box(117,827,450,61,C.pale,null,12);
  text('앱 DB 없음 · 사용자 데이터는 로컬에',135,843,21,C.muted,false);
  path([[592,710],[628,710]],C.teal,3,true);

  box(628,612,500,302,C.navy,null,19);
  box(654,636,35,35,'#23535B',null,9); text('4',664,640,21,'#BCE8DB',true);
  text('비동기 SSH·SFTP 엔진',702,632,27,C.white,true);
  text('SSH 세션 · 기능 탐지',655,687,25,C.white,true);
  text('SFTP 비동기 큐 · 전송 진행률',655,730,24,C.white,false);
  text('SSH 응답 probe',655,773,24,C.white,false);
  path([[655,819],[1101,819]],'#41656D',1.5,false);
  text('제어 연결과 전송 연결을 분리',655,844,22,'#C5E4DE',false);
  text('SSH 인증·파일 전송은 대상 서버와 직접 통신',120,938,22,C.muted,false);

  // Encrypted network paths; no central gateway.
  box(1181,352,187,83,C.white,C.border,16);
  text('암호화 연결',1210,365,23,C.teal,true);
  text('중앙 서버 없음',1200,400,20,C.muted,false);
  text('제어 SSH',1192,653,22,C.teal,true);
  path([[1128,697],[1422,697]],C.teal,4,true);
  text('전송 SSH',1192,830,22,C.teal,true);
  path([[1128,874],[1422,874]],C.teal,4,true);

  // Existing remote environment.
  box(1422,328,486,190,C.pale,null,18);
  text('지금 있는 서버 환경 사용',1447,349,26,C.navy,true);
  text('전용 앱 · DB · Python 설치 없음',1447,400,23,C.ink,false);
  text('시오스 상주 helper 없음',1447,440,23,C.ink,false);
  text('기존 계정의 SSH / SFTP 권한 필요',1447,478,20,C.muted,false);
  box(1422,588,486,144,C.light,C.border,18);
  text('OpenSSH',1448,609,28,C.teal,true);
  text('기존 셸·명령 / 기능별 요청',1448,653,24,C.ink,false);
  text('응답 측정 요청: /bin/true',1448,691,21,C.muted,false);
  box(1422,773,486,141,C.light,C.border,18);
  text('SFTP subsystem',1448,794,28,C.teal,true);
  text('파일 탐색 · 업로드 · 다운로드',1448,838,24,C.ink,false);
  text('별도 SSH 연결로 파일 전송',1448,876,21,C.muted,false);
  text('서버 스트림을 별도 클라우드로 보내지 않음',1422,938,20,C.muted,false);

  // Measurement and distribution contracts.
  box(60,1010,1100,175,C.white,C.border,21);
  text('SSH 응답을 직접 측정',86,1030,26,C.navy,true);
  text('/bin/true 요청 → exit + close 수신까지의 실제 왕복 시간',86,1072,23,C.ink,false);
  text('ICMP ping 아님 · 전송 속도로 추정하지 않음',86,1107,22,C.muted,false);
  text('측정 불가 시 해당 기능만 제한하고 상태를 표시',86,1142,22,C.muted,false);
  box(1200,1010,740,175,C.navy,null,21);
  text('다운로드하고 실행',1227,1030,26,C.white,true);
  text('Windows portable.exe  /  macOS .app',1227,1072,24,C.white,false);
  text('런타임 정책은 Electron / Tauri 비교 후 확정',1227,1110,22,'#C5E4DE',false);
  text('추가 설치 없는 실행 목표 · 별도 관리 서버 없음',1227,1144,22,'#C5E4DE',false);
  text('84 ms는 화면 설명용 예시이며 실측값이 아닙니다.',62,1210,20,C.muted,false);
  text('구조 도식 · 2026-11-14',1686,1210,18,C.muted,false);

  svg.push('</svg>');
  $.NSGraphicsContext.restoreGraphicsState;
  var svgPath=design+'/sshOS-v4-architecture.svg';
  var pngPath=design+'/sshOS-v4-architecture.png';
  if (!$(svg.join('\n')+'\n').writeToFileAtomicallyEncodingError($(svgPath),true,$.NSUTF8StringEncoding,null)) throw new Error('SVG write failed.');
  var png=bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$.NSDictionary.dictionary);
  if (!png.writeToFileAtomically($(pngPath),true)) throw new Error('PNG write failed.');
  return 'Rendered SVG and PNG: '+W+'×'+H+' in '+design;
}
