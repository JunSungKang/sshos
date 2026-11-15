/* Design-only scenes. Render with the shared sshOS mockup primitives. */
scenes['03-files'] = function () {
  shell('파일', {server: 'production-01', state: '연결됨 · SSH 응답 84 ms', tone: 'connected'});

  rect(112, 80, 1012, 784, C.paper, C.border, 12);
  rect(113, 81, 231, 782, '#F0F5F6', null, 11);
  line([344, 81], [344, 864], C.border, 1);
  txt('파일', 132, 104, 25, C.ink, true);
  icon('server', 134, 160, 21, C.teal);
  txt('production-01', 166, 158, 15, C.ink, true, 158);
  txt('Ubuntu Server 24.04 LTS', 134, 191, 12, C.muted);

  function folderRow(label, y, depth, selected, expanded) {
    var x = 132 + depth * 16;
    if (selected) rect(122, y - 8, 212, 36, '#DCEFEB', null, 6);
    if (expanded) {
      line([x, y + 8], [x + 4, y + 12], C.muted, 1.4);
      line([x + 4, y + 12], [x + 8, y + 8], C.muted, 1.4);
    } else {
      line([x + 2, y + 5], [x + 6, y + 9], C.muted, 1.4);
      line([x + 6, y + 9], [x + 2, y + 13], C.muted, 1.4);
    }
    icon('folder', x + 18, y, 18, selected ? C.teal : C.muted);
    txt(label, x + 44, y - 1, 14, selected ? C.teal : C.ink, selected, 322 - x - 44);
  }
  folderRow('/', 248, 0, false, true);
  folderRow('home', 290, 1, false, true);
  folderRow('ubuntu', 332, 2, false, true);
  folderRow('workspace', 374, 3, true, true);
  folderRow('assets', 416, 4, false, false);
  folderRow('Downloads', 470, 3, false, false);
  folderRow('var', 524, 1, false, false);
  folderRow('etc', 566, 1, false, false);
  line([132, 624], [324, 624], C.border, 1);
  txt('다른 서버', 132, 647, 12, C.muted, true);
  icon('server', 134, 684, 20, C.muted);
  txt('archive-01', 166, 683, 14, C.ink, false);
  txt('연결됨', 166, 709, 12, C.teal, false);
  txt('숨김 파일 표시', 134, 815, 12, C.muted);
  badge('켜짐', 278, 810, 46, C.teal, C.mint);

  rect(364, 94, 300, 42, C.white, C.border, 7);
  icon('folder', 378, 107, 17, C.teal);
  txt('production-01 / workspace', 406, 106, 14, C.ink, true, 230);
  txt('×', 641, 104, 18, C.muted);
  txt('archive-01 / backups', 687, 106, 13, C.muted, false, 205);
  txt('×', 903, 104, 18, C.muted);
  icon('plus', 947, 108, 18, C.muted);
  line([364, 144], [1104, 144], C.border, 1);
  button('열기', 364, 162, 88, 'normal', 'file');
  button('실행', 462, 162, 88, 'primary', 'play');
  button('업로드', 560, 162, 110, 'normal', 'up');
  button('다운로드', 680, 162, 124, 'normal', 'down');
  button('새로고침', 814, 162, 126, 'normal', 'refresh');
  button('더 보기', 950, 162, 154, 'normal');
  rect(364, 220, 740, 42, C.white, C.border, 7);
  icon('folder', 379, 233, 18, C.muted);
  txt('/home/ubuntu/workspace', 409, 232, 14, C.ink, false, 673, true);
  txt('6개 항목 · 1개 선택', 370, 281, 12, C.muted);
  txt('마지막 조회 09:42:18', 970, 281, 11.5, C.muted, false, 134);

  rect(364, 311, 740, 36, '#EAF0F2', null, 5);
  txt('이름', 409, 321, 12, C.muted, true);
  txt('종류', 724, 321, 12, C.muted, true);
  txt('크기', 879, 321, 12, C.muted, true);
  txt('수정 시각', 991, 321, 12, C.muted, true);
  var rows = [
    ['assets', '폴더', '—', '09:36', 'folder'],
    ['README.md', 'Markdown', '6.2 KiB', '09:30', 'file'],
    ['preview.png', 'PNG 이미지', '2.8 MiB', '09:33', 'image'],
    ['check-assets.sh', '셸 스크립트', '3.4 KiB', '09:38', 'terminal'],
    ['report-worker', '실행 파일', '8.6 MiB', '09:34', 'desktop'],
    ['notes.txt', '텍스트 파일', '148 B', '09:35', 'file']
  ];
  rows.forEach(function (row, index) {
    var y = 354 + index * 66;
    var selected = index === 3;
    rect(364, y, 740, 64, selected ? '#E2F1EC' : index % 2 === 0 ? C.white : C.paper, null, 5);
    if (selected) rect(364, y + 10, 3, 44, C.teal, null, 1.5);
    icon(row[4], 379, y + 20, 21, index === 0 ? '#A48343' : selected ? C.teal : index === 2 ? C.blue : C.muted);
    txt(row[0], 411, y + 14, 14, C.ink, selected, 294);
    if (index === 1) txt('읽기 전용 뷰어로 열기', 411, y + 38, 11, C.muted, false, 290);
    if (index === 3) txt('실행 권한 있음', 411, y + 38, 11, C.teal, false, 290);
    if (index === 4) txt('실행 중 · 작업에서 출력 확인', 411, y + 38, 11, C.teal, false, 290);
    txt(row[1], 724, y + 22, 12, C.muted, false, 140);
    txt(row[2], 879, y + 22, 12, C.muted, false, 99);
    txt(row[3], 991, y + 22, 12, C.muted, false, 95);
  });
  line([364, 805], [1104, 805], C.border, 1);
  txt('check-assets.sh 선택됨', 370, 824, 12, C.muted, false, 350);
  txt('목록은 새로고침할 때 갱신됩니다.', 880, 824, 11.5, C.muted, false, 224);

  rect(1144, 80, 432, 784, C.white, '#C1D6D2', 12);
  icon('terminal', 1168, 111, 23, C.teal);
  txt('실행 전 확인', 1203, 108, 22, C.ink, true, 235);
  badge('스크립트', 1464, 108, 88, C.teal, C.mint);
  txt('check-assets.sh', 1168, 158, 23, C.ink, true, 384, true);
  txt('선택한 파일을 서버에서 실행합니다.', 1168, 198, 13, C.muted, false, 384);
  line([1168, 237], [1552, 237], C.border, 1);
  txt('서버', 1168, 258, 12, C.muted, true);
  txt('production-01', 1168, 282, 16, C.ink, true, 222);
  txt('사용자', 1431, 258, 12, C.muted, true);
  txt('ubuntu', 1431, 282, 15, C.ink, false, 120, true);
  txt('원격 전체 경로', 1168, 329, 13, C.muted, true);
  rect(1168, 356, 384, 66, '#F1F6F6', null, 7);
  txt('/home/ubuntu/workspace/', 1181, 366, 13, C.ink, false, 358, true);
  txt('check-assets.sh', 1181, 391, 13, C.ink, false, 358, true);
  field('실행 인수', '--check-only', 1168, 448, 384, true);
  field('작업 폴더', '/home/ubuntu/workspace', 1168, 542, 384, true);
  icon('check', 1169, 643, 18, C.teal);
  txt('이 파일에 실행 권한이 있습니다.', 1197, 643, 13, C.teal, false, 350);
  button('읽기 전용으로 열기', 1168, 735, 222, 'normal', 'file');
  button('실행', 1402, 735, 150, 'primary', 'play');
  txt('실행 출력은 작업에서 확인할 수 있습니다.', 1168, 807, 12, C.muted, false, 384);
  cursor(1500, 759);
  shelf();
};

scenes['04-tasks'] = function () {
  shell('작업', {server: 'production-01', state: '연결됨 · SSH 응답 84 ms', tone: 'connected'});

  rect(112, 80, 432, 784, C.paper, C.border, 12);
  txt('작업', 132, 107, 25, C.ink, true);
  badge('4', 197, 109, 30, C.muted, '#E4ECEF');
  txt('실행과 전송을 한곳에서 확인합니다.', 132, 151, 13, C.muted, false, 388);
  badge('전체 4', 132, 191, 84, C.teal, C.mint);
  txt('진행 중 3', 242, 198, 13, C.muted);
  txt('종료 1', 367, 198, 13, C.muted);

  rect(132, 240, 392, 125, C.white, C.border, 9);
  icon('up', 150, 258, 21, C.teal);
  txt('release-assets.zip', 183, 256, 15, C.ink, true, 321);
  txt('production-01 · 업로드', 150, 289, 12, C.muted);
  txt('348 / 512 MiB · 68%', 150, 319, 13, C.teal, true, 247);
  txt('12.4 MiB/s', 421, 320, 11.5, C.muted, false, 84);
  progress(150, 349, 356, 68, C.teal);

  rect(132, 379, 392, 139, C.white, C.border, 9);
  icon('down', 150, 397, 21, C.blue);
  txt('backup-2026-11-15.tar.gz', 183, 395, 14, C.ink, true, 321);
  txt('archive-01 · 다운로드', 150, 428, 12, C.muted);
  txt('전송 16 / 16 GiB · 내용 확인 중', 150, 453, 12, C.blue, true, 356);
  txt('6.88 / 16 GiB · 43%', 150, 479, 12, C.blue, false, 232);
  txt('128 MiB/s', 422, 479, 11.5, C.muted, false, 84);
  progress(150, 503, 356, 43, C.blue);

  rect(132, 532, 392, 124, '#E7F3EF', '#A6CBBF', 9);
  rect(132, 544, 3, 99, C.teal, null, 1.5);
  icon('terminal', 150, 551, 21, C.teal);
  txt('report-worker', 183, 549, 15, C.ink, true, 321);
  txt('production-01 · 프로그램 실행', 150, 582, 12, C.muted);
  badge('실행 중', 150, 612, 75, C.teal, '#D1EAE1');
  txt('종료 코드 대기', 413, 618, 11.5, C.muted, false, 92);

  rect(132, 670, 392, 115, C.white, C.border, 9);
  icon('check', 150, 689, 21, C.teal);
  txt('check-assets.sh', 183, 687, 15, C.ink, true, 321);
  txt('production-01 · 스크립트 실행', 150, 719, 12, C.muted);
  txt('프로세스 종료 · 코드 0', 150, 749, 12, C.teal, true, 258);
  txt('09:39:42', 443, 749, 11.5, C.muted, false, 63, true);
  txt('화면을 이동해도 실행과 전송은 계속됩니다.', 132, 821, 12, C.muted, false, 392);

  rect(564, 80, 1012, 784, C.white, C.border, 12);
  txt('프로그램 실행  /  production-01', 596, 108, 13, C.muted);
  txt('report-worker', 596, 145, 29, C.ink, true, 740);
  badge('실행 중', 1440, 147, 104, C.teal, C.mint);
  txt('시작 09:42:12 · 사용자 ubuntu', 596, 191, 14, C.muted);

  rect(596, 235, 948, 122, '#F3F7F8', null, 9);
  txt('원격 파일', 615, 252, 12, C.muted, true);
  txt('/home/ubuntu/workspace/report-worker', 754, 250, 13, C.ink, false, 770, true);
  txt('작업 폴더', 615, 286, 12, C.muted, true);
  txt('/home/ubuntu/workspace', 754, 284, 13, C.ink, false, 770, true);
  txt('실행 인수', 615, 320, 12, C.muted, true);
  txt('--input ./assets --output ./report.json', 754, 318, 13, C.ink, false, 770, true);

  rect(596, 381, 948, 316, '#132E36', null, 10);
  icon('terminal', 616, 401, 20, '#D5EAE9');
  txt('실행 출력', 648, 399, 14, '#F2F8F8', true);
  badge('입력 없음', 1422, 396, 102, '#B8D5D8', '#24434A');
  line([616, 438], [1524, 438], '#34515A', 1);
  var output = [
    ['09:42:12', 'report-worker started', '#E7F4F1'],
    ['09:42:13', 'scan 183 files', '#A5DAC8'],
    ['09:42:15', 'warn 2 missing thumbnails', '#EDC77F'],
    ['09:42:17', 'writing report', '#E7F4F1']
  ];
  output.forEach(function (row, index) {
    var y = 459 + index * 37;
    txt(row[0], 617, y, 13, '#91AFB7', false, 92, true);
    txt(row[1], 724, y, 14, row[2], false, 798, true);
  });
  txt('출력을 기다리는 중…', 617, 657, 12, '#A0BFC5', false, 907);

  txt('종료 코드', 596, 726, 13, C.muted, true);
  txt('대기 중', 695, 725, 14, C.ink, true);
  txt('프로세스가 실행 중입니다.', 786, 726, 13, C.muted);
  line([596, 766], [1544, 766], C.border, 1);
  button('출력 창 열기', 596, 791, 170, 'normal', 'terminal');
  txt('중지 결과는 응답을 받은 뒤 표시합니다.', 790, 804, 12, C.muted, false, 542);
  button('중지 요청', 1356, 791, 188, 'normal');
  shelf();
};
