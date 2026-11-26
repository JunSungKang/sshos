import {_electron as electron,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {root,localPath,runtimeEnvironment,closeTestApplication} from './environment.mjs';
import {startSSHFixture} from './fixtures/ssh-server.mjs';
const base=localPath(`fixtures/text-edit-${randomUUID()}`),env=runtimeEnvironment(`text-edit-${randomUUID()}`),pictures=localPath('evidence/text-edit');
Object.assign(process.env,env);const {default:executablePath}=await import('electron');let application,fixture;
const homePath=join(base,'home/fixture'),path=join(homePath,'edit.txt'),original='\ufeff\ufefforiginal 한글\r\nsecond line\r\n',changed='\ufeffeditor-canary 수정\nsecond line\n';
const shells=[];
try{
 await fs.mkdir(join(base,'etc'),{recursive:true});await fs.mkdir(homePath,{recursive:true});await fs.writeFile(join(base,'etc/os-release'),'ID=ubuntu\nVERSION_ID=24.04\n');await fs.writeFile(path,original,{mode:0o640});
 fixture=await startSSHFixture(base,{atomicRename:true,shell:({accept})=>{const channel=accept(),state={closed:false};shells.push(state);channel.write('fixture shell\r\n$ ');channel.on('data',bytes=>channel.write(bytes));channel.on('close',()=>{state.closed=true;});}});
 application=await electron.launch({executablePath,args:[`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`,root],cwd:root,env,timeout:20000});const page=await application.firstWindow();page.setDefaultTimeout(20000);
 await page.getByTestId('engine-state').filter({hasText:'연결 엔진 준비됨'}).waitFor();
 const png=await application.evaluate(({nativeImage})=>{const bytes=Buffer.from([8,127,120,255]);return nativeImage.createFromBitmap(Buffer.concat(Array.from({length:16*12},()=>bytes)),{width:16,height:12}).toPNG().toString('base64');});
 const jpeg=await application.evaluate(({nativeImage},png)=>nativeImage.createFromBuffer(Buffer.from(png,'base64')).toJPEG(95).toString('base64'),png);
 const webp=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=16;c.height=12;c.getContext('2d').fillRect(0,0,16,12);return c.toDataURL('image/webp').split(',')[1];});
 for(const [name,bytes]of [['picture.png',png],['picture.JPG',jpeg],['picture.jpeg',jpeg],['picture.webp',webp]])await fs.writeFile(join(homePath,name),Buffer.from(bytes,'base64'));
 await page.evaluate(async port=>{const p=await window.sshOS.profile.create({name:'Editor fixture',host:'127.0.0.1',port,username:'fixture',authentication:'password'});await window.sshOS.session.connect(p.id,{password:'test-only',saveSecret:false});},fixture.port);await page.getByRole('button',{name:'지문을 확인하고 연결'}).click();
 const home=page.locator('.desktop-home:visible');await home.getByText('edit.txt',{exact:true}).dblclick();const viewer=page.getByRole('region',{name:'텍스트 / edit.txt · Editor fixture',exact:true});
 await viewer.getByLabel('뷰어 읽기 상태').filter({hasText:'읽기 전용'}).waitFor();await expect(viewer.getByRole('textbox',{name:'텍스트 편집 내용'})).toHaveCount(0);
 const sourceFile = join(base, 'external-drop.txt');
 await fs.writeFile(sourceFile, '🎯\r\n');
 const location = await viewer.locator('pre[data-text-start="0"]').evaluate(pre => {
   const range = document.createRange();
   range.setStart(pre.firstChild, 4); range.collapse(true);
   const r = range.getBoundingClientRect();
   return {x:r.x + 0.1, y:r.y + r.height / 2};
 });
 const nativeDrag = await page.context().newCDPSession(page);
 const drag = async (point) => {
   const data = {items:[],files:[sourceFile],dragOperationsMask:1};
   for (const type of ['dragEnter','dragOver','drop'])
     await nativeDrag.send('Input.dispatchDragEvent', {type, ...point, data});
 };
 await drag(location);
 await viewer.getByRole('button',{name:'편집 모드로 전환해 여기에 삽입'}).click();
 const draggedEditor = viewer.getByRole('textbox',{name:'텍스트 편집 내용'});
 const nativeBaseline = '\ufefforiginal 한글\nsecond line\n';
 await expect(draggedEditor).toHaveValue(nativeBaseline.slice(0,4) + '🎯\n' + nativeBaseline.slice(4));
 const area = await draggedEditor.boundingBox();
 await drag({x:area.x + 20, y:area.y + 22});
 await expect(draggedEditor).toHaveValue('🎯\n' + nativeBaseline.slice(0,4) + '🎯\n' + nativeBaseline.slice(4));
 await nativeDrag.detach();
 assert.equal(await fs.readFile(path,'utf8'), original);
 await viewer.getByRole('button',{name:'편집 취소',exact:true}).click();
 await viewer.getByRole('button',{name:'변경 버리기',exact:true}).click();
 const chooseText = async (name, text) => {
   const localFile = join(base, 'insert.txt');
   await fs.writeFile(localFile, text);
   const chooser = page.waitForEvent('filechooser');
   await viewer.getByRole('button', {name}).click();
   await (await chooser).setFiles(localFile);
 };
 await chooseText('문서 처음에 파일 삽입…', '\ufeff');
 await expect(viewer.getByLabel('뷰어 읽기 상태')).toHaveText('빈 텍스트 파일입니다.');
 await chooseText('문서 처음에 파일 삽입…', '로컬🙂\r\n');
 await viewer.getByRole('button',{name:'편집 모드로 전환해 여기에 삽입'}).click();
 const dropEditor = viewer.getByRole('textbox',{name:'텍스트 편집 내용'});
 const baseline = '\ufefforiginal 한글\nsecond line\n';
 await expect(dropEditor).toHaveValue('로컬🙂\n' + baseline);
 const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
 await dropEditor.press(undoKey);
 await expect(dropEditor).toHaveValue(baseline);
 await dropEditor.press('m');
 await expect(dropEditor).toHaveValue('m' + baseline);
 await chooseText('커서에 파일 삽입…', 'drop');
 await expect(dropEditor).toHaveValue('mdrop' + baseline);
 await dropEditor.press(undoKey);
 await expect(dropEditor).toHaveValue('m' + baseline);
 await dropEditor.press(undoKey);
 await expect(dropEditor).toHaveValue(baseline);
 assert.equal(await fs.readFile(path,'utf8'), original);
 // A pending file read must never insert text into the active input of a different dialog.
 await page.evaluate(() => {
   const originalRead = Blob.prototype.arrayBuffer;
   Blob.prototype.arrayBuffer = async function () {
     Blob.prototype.arrayBuffer = originalRead;
     await new Promise(resolve => {window.__releaseViewerRead = resolve;});
     return originalRead.call(this);
   };
 });
 await chooseText('커서에 파일 삽입…','late-file-input');
 await page.waitForFunction(() => typeof window.__releaseViewerRead === 'function');
 await page.getByRole('button',{name:'Connect',exact:true}).click();
 await page.getByRole('button',{name:'서버 추가',exact:true}).click();
 const profileDialog = page.getByRole('dialog',{name:'서버 추가',exact:true});
 const otherInput = profileDialog.getByRole('textbox',{name:'서버 이름',exact:true});
 await otherInput.fill('keep this profile draft');
 await page.evaluate(() => {window.__releaseViewerRead(); delete window.__releaseViewerRead;});
 await page.waitForFunction(() => document.activeElement?.value !== 'keep this profile draft' ||
   document.querySelector('.viewer-status')?.textContent.includes('입력 대상이 바뀌었습니다.'));
 await expect(otherInput).toHaveValue('keep this profile draft');
 await expect(otherInput).toBeFocused();
 await expect(page.locator('.viewer-status')).toContainText('입력 대상이 바뀌었습니다.');
 await profileDialog.getByRole('button',{name:'접속 설정 닫기'}).click();
 await page.getByRole('button',{name:'Desktop',exact:true}).click();
 await expect(dropEditor).toHaveValue(baseline);
 await viewer.getByRole('button',{name:'편집 취소',exact:true}).click();
 await viewer.getByRole('button',{name:'편집',exact:true}).click();const editor=viewer.getByRole('textbox',{name:'텍스트 편집 내용'});await expect(editor).toHaveValue('\ufefforiginal 한글\nsecond line\n');await editor.fill(changed);const geometry=await editor.evaluate(element=>{const style=getComputedStyle(element);return {height:element.getBoundingClientRect().height,viewport:element.parentElement.clientHeight,paddingTop:style.paddingTop,paddingLeft:style.paddingLeft};});assert.ok(geometry.height>=120 && Math.abs(geometry.height-geometry.viewport)<=2);assert.equal(geometry.paddingTop,'16px');assert.equal(geometry.paddingLeft,'20px');assert.equal(await fs.readFile(path,'utf8'),original);assert.equal(fixture.metrics.writes,0);
 await page.getByRole('button',{name:'텍스트 / edit.txt · Editor fixture 닫기',exact:true}).click();const close=page.getByRole('dialog',{name:'텍스트 창 닫기 확인'});await close.getByRole('button',{name:'계속 편집'}).click();await expect(editor).toHaveValue(changed);
 await application.evaluate(({app,dialog})=>{app.__nativeDialog=dialog.showMessageBox;dialog.showMessageBox=async(...args)=>{app.__editQuitPrompt=args.at(-1);return {response:0,checkboxChecked:false};};app.quit();});await expect.poll(()=>application.evaluate(({app})=>app.__editQuitPrompt?.detail ?? '')).toContain('편집 중인 텍스트 1개');await expect(editor).toHaveValue(changed);await application.evaluate(({app,dialog})=>{dialog.showMessageBox=app.__nativeDialog;});
 await page.screenshot({path:join(pictures,'editing.png')});await viewer.getByRole('button',{name:'저장',exact:true}).click();
 await expect.poll(()=>fs.readFile(path,'utf8')).toBe('\ufeff'+changed.replaceAll('\n','\r\n'));await viewer.getByLabel('뷰어 읽기 상태').filter({hasText:'읽기 전용'}).waitFor();assert.equal((await fs.stat(path)).mode&0o777,0o640);assert.equal(fixture.metrics.renames,1);assert.equal((await fs.readdir(homePath)).some(name=>name.startsWith('.sshos-edit-')),false);
 const tasks=await page.evaluate(()=>window.sshOS.task.list(0));assert.ok(tasks.rows.some(row=>row.operation==='edit' && row.phase==='completed'));
 await viewer.getByRole('button',{name:'편집',exact:true}).click();await editor.fill('my unsaved draft\n');await fs.writeFile(path,'external change\n');await viewer.getByRole('button',{name:'저장',exact:true}).click();await viewer.getByRole('alert').getByText('선택한 이후 원본 파일이 변경됐습니다.',{exact:true}).waitFor();await expect(editor).toHaveValue('my unsaved draft\n');assert.equal(await fs.readFile(path,'utf8'),'external change\n');assert.equal(fixture.metrics.renames,1);
 await viewer.getByRole('button',{name:'편집 취소',exact:true}).click();await page.getByRole('dialog',{name:'편집 취소 확인'}).getByRole('button',{name:'변경 버리기'}).click();await viewer.getByRole('button',{name:'다시 읽기',exact:true}).click();await viewer.getByRole('textbox',{name:'텍스트 내용'}).getByText('external change',{exact:true}).waitFor();await viewer.getByRole('button',{name:'편집',exact:true}).click();await editor.fill('discard this draft');await page.getByRole('button',{name:'텍스트 / edit.txt · Editor fixture 닫기',exact:true}).click();await page.getByRole('dialog',{name:'텍스트 창 닫기 확인'}).getByRole('button',{name:'변경 버리고 닫기',exact:true}).click();await viewer.waitFor({state:'detached'});assert.equal(await fs.readFile(path,'utf8'),'external change\n');
 for(const name of ['picture.png','picture.JPG','picture.jpeg','picture.webp']){await home.getByText(name,{exact:true}).dblclick();const image=page.getByRole('region',{name:`이미지 / ${name} · Editor fixture`,exact:true});await image.getByLabel('뷰어 읽기 상태').filter({hasText:'읽기 전용'}).waitFor();assert.equal(await image.getByRole('img').getAttribute('width'),'16');assert.equal(await image.getByRole('img').getAttribute('height'),'12');await page.getByRole('button',{name:`이미지 / ${name} · Editor fixture 닫기`,exact:true}).click();}
 await page.getByRole('button',{name:'Console',exact:true}).click();await page.locator('.console-workspace:visible').getByText('입력 가능',{exact:true}).waitFor();await page.locator('.console-tabs:visible').getByRole('button',{name:'새 터미널',exact:true}).click();await expect.poll(()=>shells.length).toBe(2);await page.locator('.console-workspace:visible').getByText('입력 가능',{exact:true}).waitFor();
 const active=await page.locator('.console-workspace:visible').getAttribute('data-terminal-window-id');await expect(page.getByRole('button',{name:'터미널 닫기',exact:true})).toHaveCount(0);const inactive=page.locator('.console-tabs:visible .console-tab[data-active=false]');await inactive.getByRole('button',{name:'터미널 1 탭 닫기',exact:true}).click();let prompt=page.getByRole('dialog',{name:'터미널 세션 닫기'});await prompt.getByRole('button',{name:'세션 닫기',exact:true}).click();await prompt.waitFor({state:'detached'});await expect(page.locator('.console-workspace:visible')).toHaveAttribute('data-terminal-window-id',active);await expect.poll(()=>shells[0].closed).toBe(true);assert.equal(shells[1].closed,false);
 await page.screenshot({path:join(pictures,'tab-close.png')});await page.locator('.console-tabs:visible').getByRole('button',{name:'터미널 2 탭 닫기',exact:true}).click();prompt=page.getByRole('dialog',{name:'터미널 세션 닫기'});await prompt.getByRole('button',{name:'유지',exact:true}).click();assert.equal(shells[1].closed,false);await page.locator('.console-tabs:visible').getByRole('button',{name:'터미널 2 탭 닫기',exact:true}).click();await page.getByRole('dialog',{name:'터미널 세션 닫기'}).getByRole('button',{name:'세션 닫기',exact:true}).click();await expect.poll(()=>shells[1].closed).toBe(true);await expect(page.locator('.console-workspace')).toHaveCount(0);await expect(page.getByRole('button',{name:'터미널 열기',exact:true})).toBeVisible();assert.equal(shells.length,2);
 for(const name of (await fs.readdir(join(env.SSHOS_RUNTIME_ROOT,'data/receipts'))).filter(name=>/\.json(?:\.bak)?$/u.test(name))){const raw=await fs.readFile(join(env.SSHOS_RUNTIME_ROOT,'data/receipts',name),'utf8');assert.equal(raw.includes('editor-canary'),false);}
 const report={status:'pass',checks:['read-only default and explicit editing','CDP file drop into virtual reader and textarea at pointed offsets','native picker inserts as one undo with prior typing preserved','editor fills viewport with comfortable padding','zero writes until Save','BOM plus leading U+FEFF body/CRLF/mode preserved','completed durable edit record without text contents','conflict preserves external file and draft','discard and close confirmation','native quit warns about editing','Desktop PNG/JPG/JPEG/WebP dimensions','inactive tab close leaves current PTY untouched','active tab close confirmation can cancel; final tab closes without creating a replacement PTY'],limitation:'Current-host development Electron/loopback fixture; no native targets or real Ubuntu/OpenSSH acceptance.'};await fs.writeFile(join(pictures,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){if(application)await (await application.firstWindow()).screenshot({path:join(pictures,'failure.png')}).catch(()=>{});throw error;}finally{if(application)await closeTestApplication(application);if(fixture)await fixture.close();await fs.rm(base,{recursive:true,force:true});await fs.rm(env.SSHOS_RUNTIME_ROOT,{recursive:true,force:true});}
