import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
const element = document.getElementById('terminal');
if (!element) throw new Error('Fixture container absent');
const terminal = new Terminal({ allowProposedApi: false });
const fit = new FitAddon();
terminal.loadAddon(fit); terminal.open(element); fit.fit();
let evalBlocked = false;
try { Function('return 1')(); } catch { evalBlocked = true; }
terminal.write('시오스 터미널 렌더링 검사\r\n', () => { const ready = document.createElement('output'); ready.dataset['testid'] = 'xterm-ready'; ready.dataset['evalBlocked'] = String(evalBlocked); ready.textContent = `${terminal.cols}×${terminal.rows}`; document.body.append(ready); });
