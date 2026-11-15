/* Desktop scene: client-owned windows; no remote GUI forwarding. */
scenes['01-desktop']=function(){
  shell('데스크톱');
  txt('데스크톱',118,83,25,C.ink,true);txt('production-01 · 열린 창 4',118,121,12,C.muted);
  var apps=[['파일','folder',181],['텍스트','file',294],['이미지','image',407],['터미널','terminal',520]];
  apps.forEach(function(a){rect(127,a[2],66,64,'#F4F9FA','#D1E1E3',14);icon(a[1],147,a[2]+17,26,C.teal);center(a[0],117,a[2]+74,86,13,C.ink,true);});
  txt('창을 전환해도',119,750,11,C.muted);txt('작업은 유지됩니다.',119,769,11,C.muted);

  win(232,160,638,304,'README.md','production-01 · /home/ubuntu/workspace/README.md','file',false);
  var textLines=['# Workspace notes','','Assets live in ./assets','Run checks before generating a report.','','Owner: content-team'];
  textLines.forEach(function(s,i){txt(String(i+1),249,259+i*24,12,C.faint,false,null,true);txt(s,285,257+i*24,13.5,i===0?C.teal:C.ink,i===0,550,true);});
  line([233,427],[869,427],'#E6EDF0');txt('읽기 전용 · UTF-8 · 6.2 KiB',249,439,11,C.muted);icon('search',813,438,15,C.muted);icon('refresh',840,438,15,C.muted);

  win(916,126,628,374,'preview.png','production-01 · /home/ubuntu/workspace/preview.png','image',false);
  var ix=936,iy=226,iw=588,ih=219;
  rect(ix,iy,iw,ih,'#D8E9E7',null,4);
  for(var i=0;i<105;i++){var p=i/104;var rgb=[209-18*p,229-8*p,226-6*p].map(function(v){return Math.round(v).toString(16).padStart(2,'0');}).join('');rect(ix,iy+i,iw,1,'#'+rgb);}
  circle(ix+465,iy+42,18,'#FAF3D7');
  poly([[ix,iy+121],[ix+90,iy+57],[ix+170,iy+130],[ix+282,iy+40],[ix+389,iy+138],[ix+500,iy+69],[ix+588,iy+133],[ix+588,iy+167],[ix,iy+167]],null,1,true,'#8CAEB0');
  poly([[ix+216,iy+96],[ix+282,iy+40],[ix+341,iy+94],[ix+307,iy+78],[ix+283,iy+86],[ix+263,iy+73]],null,1,true,'#E8F2EE');
  poly([[ix+53,iy+88],[ix+90,iy+57],[ix+127,iy+92],[ix+99,iy+80],[ix+83,iy+81]],null,1,true,'#E8F2EE');
  poly([[ix,iy+153],[ix+77,iy+115],[ix+134,iy+141],[ix+206,iy+112],[ix+304,iy+158],[ix+415,iy+102],[ix+503,iy+150],[ix+588,iy+123],[ix+588,iy+184],[ix,iy+184]],null,1,true,'#5D8D8D');
  rect(ix,iy+165,iw,54,'#86B4B2');
  for(var k=0;k<9;k++)line([ix+40+k*21,iy+176+k*4],[ix+iw-55-k*30,iy+176+k*4],k%2?'#A7C9C4':'#79A6A4',1);
  poly([[ix,iy+166],[ix+66,iy+156],[ix+105,iy+175],[ix+152,iy+219],[ix,iy+219]],null,1,true,'#285F60');
  poly([[ix+470,iy+219],[ix+519,iy+176],[ix+588,iy+159],[ix+588,iy+219]],null,1,true,'#285F60');
  for(var j=0;j<7;j++){var tx=ix+9+j*11,ty=iy+151+j*3;poly([[tx,ty-26],[tx-9,ty+2],[tx+9,ty+2]],null,1,true,'#285F60');}
  txt('1920 × 720 · 2.8 MiB',936,468,11,C.muted);rect(1291,457,82,28,'#EEF4F5',null,6);center('화면 맞춤',1291,463,82,11,C.ink,true);txt('−',1392,459,20,C.muted);txt('31%',1424,463,12,C.ink);txt('+',1491,459,20,C.muted);

  win(232,500,638,350,'터미널 · vi notes.txt','production-01 · ubuntu · /home/ubuntu/workspace','terminal',false);
  rect(233,585,636,228,'#153039');
  var viLines=['Server notes','','Upload assets before running the report.','Check report.json after the job completes.','','Maintenance window: 22:00-22:30 KST'];
  viLines.forEach(function(s,i){txt(s,253,602+i*23,12.3,'#D4E5E6',false,595,true);});
  txt('~',253,742,13,'#8DB5CC',false,null,true);txt('~',253,765,13,'#8DB5CC',false,null,true);
  rect(253,602,7,16,'#80C6B8');txt('S',253,602,12.3,'#153039',false,null,true);
  txt('"notes.txt" 6L, 148B',253,791,11,'#B6CDD0',false,null,true);txt('1,1',792,791,11,'#B6CDD0',false,null,true);
  circle(253,833,3,C.teal);txt('키보드 입력 연결됨',265,824,11,C.teal,true);txt('SSH 터미널',754,824,11,C.muted);

  win(916,536,628,314,'실행 출력 · report-worker','production-01 · /home/ubuntu/workspace','terminal',true);
  rect(917,621,626,175,'#132E36');
  var output=[['$ ./report-worker --input ./assets --output ./report.json','#E2EEEE'],['09:42:12  report-worker started','#BDD0D3'],['09:42:13  scan 183 files','#BDD0D3'],['09:42:15  warn 2 missing thumbnails','#E6C58B'],['09:42:17  writing report','#86CEBB']];
  output.forEach(function(a,i){txt(a[0],937,637+i*28,12.3,a[1],false,584,true);});
  circle(938,822,3.5,C.teal);txt('실행 중',950,812,13,C.teal,true);txt('종료 코드 대기',1035,814,11,C.muted);rect(1390,804,132,31,C.mint,null,6);center('작업에서 보기',1390,811,132,12,C.teal,true);cursor(1490,826);
  shelf();
};
