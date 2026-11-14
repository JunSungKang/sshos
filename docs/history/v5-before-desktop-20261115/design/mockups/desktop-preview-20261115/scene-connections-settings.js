/* Design-only scenes. Uses shared renderer primitives; no app or network code. */
scenes['02-connections'] = function () {
  shell('연결', {server:'staging-01', state:'호스트 승인 대기', tone:'pending'});

  rect(112,80,288,784,'#EFF4F6',C.border,12);
  txt('내 서버',132,106,21,C.ink,true);
  badge('3',218,109,28,C.muted,'#DFE8EC');
  icon('plus',352,110,20,C.muted);

  function profile(name,address,y,selected,pending) {
    rect(132,y,248,98,selected?C.white:'#E8F0F2',selected?'#A9C8C1':null,9);
    icon('server',148,y+18,21,selected?C.teal:C.muted);
    txt(name,182,y+14,15,C.ink,true,180);
    txt(address,182,y+42,11.5,C.muted,false,180,true);
    badge(pending?'호스트 승인 대기':'연결됨',148,y+66,pending?126:66,pending?C.amber:C.teal,pending?C.amberPale:C.mint);
  }
  profile('production-01','203.0.113.24 : 22',164,false,false);
  profile('archive-01','203.0.113.42 : 22',278,false,false);
  profile('staging-01','203.0.113.60 : 22',392,true,true);
  line([132,752],[380,752],C.border,1);
  txt('연결됨 2 · 승인 대기 1',132,776,13,C.muted,true);
  txt('연결 정보는 이 PC에 저장됩니다.',132,812,12,C.muted);

  rect(420,80,1156,784,C.paper,C.border,12);
  txt('서버 연결',452,107,28,C.ink,true);
  txt('staging-01의 호스트 지문을 확인하세요.',452,151,15,C.muted);

  rect(452,195,472,44,'#E7EEF0',null,8);
  rect(456,199,230,36,C.white,null,6);
  icon('key',493,208,17,C.teal);
  txt('SSH 개인키',521,207,14,C.teal,true);
  txt('비밀번호',762,207,14,C.muted);
  field('연결 이름','staging-01',452,262,472,false);
  field('서버 주소','203.0.113.60',452,356,336,true);
  field('포트','22',806,356,118,true);
  field('사용자 이름','ubuntu',452,450,472,true);
  txt('개인키 파일',452,544,13,C.muted,true);
  rect(452,570,472,50,C.white,C.border,7);
  icon('key',468,584,21,C.muted);
  txt('staging_ed25519',500,585,14,C.ink,false,270,true);
  txt('파일 변경',838,586,12,C.teal,true);
  rect(453,651,17,17,C.white,C.border,3);
  txt('비밀번호·개인키 암호 저장',481,648,14,C.ink);
  txt('선택한 경우에만 이 PC에 암호화하여 저장합니다.',452,682,12,C.muted,false,472);
  button('호스트 승인 대기',452,756,472,'disabled');

  rect(958,195,586,625,C.white,'#C6D7D2',12);
  rect(986,223,50,50,C.amberPale,null,12);
  icon('shield',999,235,25,C.amber);
  badge('처음 연결',1414,232,102,C.amber,C.amberPale);
  txt('서버의 호스트 키를 확인하세요.',986,296,22,C.ink,true,530);
  txt('서버 관리자가 제공한 지문과 비교하세요.',986,337,15,C.muted,false,530);
  line([986,380],[1516,380],C.border,1);
  txt('연결 대상',986,405,12,C.muted,true);
  txt('staging-01',986,432,18,C.ink,true);
  txt('203.0.113.60 : 22',986,464,14,C.muted,false,530,true);
  txt('호스트 키 · ED25519',986,510,12,C.muted,true);
  rect(986,538,530,73,'#F2F6F7',null,7);
  txt('SHA256:',1000,548,12,C.muted,true,null,true);
  txt('vR8r7Q2KpL4eTs9mNc6UjW1bH0xF5dY3oAqZsGkIuE8',1000,575,12.3,C.ink,false,502,true);
  txt('승인 전에는 로그인을 진행하지 않습니다.',986,637,14,C.ink,false,530);
  txt('서버의 운영체제와 SSH 응답은 연결 후 확인합니다.',986,666,12,C.muted,false,530);
  button('취소',986,738,112,'normal');
  button('승인하고 연결',1114,738,402,'primary');
  cursor(1398,763);
  shelf();
};

scenes['05-settings'] = function () {
  shell('설정', {server:'production-01', state:'연결됨 · SSH 응답 84 ms', tone:'connected'});

  rect(112,80,1464,784,C.paper,C.border,12);
  txt('설정',140,107,28,C.ink,true);
  txt('이 PC에 저장하는 연결 정보와 앱 설정을 관리합니다.',140,151,15,C.muted);

  rect(140,194,850,130,C.white,C.border,10);
  txt('일반',164,215,18,C.ink,true);
  txt('표시 언어',164,265,15,C.ink,true);
  rect(802,253,164,40,'#F5F8F9',C.border,7);
  txt('한국어',860,264,14,C.ink,true);

  rect(140,344,850,276,C.white,C.border,10);
  icon('shield',164,367,21,C.teal);
  txt('인증 정보와 호스트 신뢰',198,364,18,C.ink,true);
  txt('비밀번호·개인키 암호 저장',164,414,15,C.ink,true);
  badge('꺼짐',834,410,60,C.muted,'#EDF2F4');
  rect(914,413,52,27,'#CAD6DB',null,13.5);
  rect(918,417,19,19,C.white,null,9.5);
  txt('기본값은 꺼짐입니다. 저장을 선택하면 OS 암호화로 보호합니다.',164,447,13,C.muted,false,802);
  line([164,483],[966,483],C.border,1);
  txt('신뢰하는 호스트',164,507,15,C.ink,true);
  txt('production-01 · archive-01',164,540,13,C.muted,false,550);
  button('호스트 신뢰 관리',798,507,168,'normal','shield');
  txt('호스트 키가 바뀌면 다시 확인하기 전까지 연결하지 않습니다.',164,582,12,C.muted,false,802);

  rect(1014,194,534,426,C.white,C.border,10);
  rect(1040,218,48,48,C.mint,null,12);
  icon('server',1052,230,24,C.teal);
  txt('sshOS(시오스)',1104,221,25,C.ink,true);
  txt('앱 정보',1104,258,13,C.muted);
  line([1040,298],[1522,298],C.border,1);
  txt('데스크톱',1040,323,13,C.muted);
  txt('macOS · Windows',1184,321,15,C.ink,true,338);
  txt('지원 서버',1040,379,13,C.muted);
  txt('Ubuntu Server 24.04 LTS',1184,377,15,C.ink,true,338);
  txt('라이선스',1040,435,13,C.muted);
  txt('AGPL-3.0-only',1184,433,15,C.ink,true,338,true);
  line([1040,483],[1522,483],C.border,1);
  txt('로컬 데이터',1040,510,14,C.ink,true);
  txt('설정 · 연결 프로필 · 작업 기록',1040,545,13,C.muted,false,482);
  txt('저장 위치: 이 PC',1040,576,13,C.muted);

  rect(140,640,1408,198,C.white,C.border,10);
  txt('기록과 진단',164,661,18,C.ink,true);
  txt('작업 기록',164,710,15,C.ink,true);
  txt('종료된 작업의 기록을 정리합니다.',164,743,13,C.muted,false,390);
  button('기록 정리',572,707,132,'normal');
  line([742,704],[742,808],C.border,1);
  txt('진단 내보내기',772,710,15,C.ink,true);
  txt('저장할 내용을 확인한 뒤 파일로 내보냅니다.',772,743,13,C.muted,false,455);
  button('진단 내보내기',1324,707,198,'normal','down');
  txt('비밀번호·개인키·서버 주소·파일 경로는 진단에 포함하지 않습니다.',772,791,12,C.muted,false,750);
  shelf();
};
