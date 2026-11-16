import {_electron as electron,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {themes} from '../dist/shared/themes.js';
import {root,localPath,runtimeEnvironment,closeTestApplication} from './environment.mjs';
import {startSSHFixture} from './fixtures/ssh-server.mjs';

const base=localPath(`fixtures/themes-${randomUUID()}`),env=runtimeEnvironment(`themes-${randomUUID()}`),pictures=localPath('evidence/themes');
Object.assign(process.env,env);const {default:executablePath}=await import('electron');
let application,fixture;const inputs=[],observations=[];
const rgb=color=>`rgb(${[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16)).join(', ')})`;
const launch=async()=>{application=await electron.launch({executablePath,args:[`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`,root],cwd:root,env,timeout:15000});const page=await application.firstWindow();page.setDefaultTimeout(15000);await page.setViewportSize({width:1600,height:1000});await page.getByTestId('engine-state').filter({hasText:'연결 엔진 준비됨'}).waitFor();return page;};
try{
 await fs.mkdir(join(base,'etc'),{recursive:true});await fs.writeFile(join(base,'etc/os-release'),'ID=ubuntu\nVERSION_ID=24.04\n');await fs.mkdir(join(base,'home/fixture/projects'),{recursive:true});
 for(let index=0;index<300;index++)await fs.writeFile(join(base,`home/fixture/item-${String(index).padStart(3,'0')}.txt`),'fixture');
 for(let index=0;index<50;index++)await fs.writeFile(join(base,`home/fixture/projects/nested-${String(index).padStart(2,'0')}.txt`),'fixture');
 fixture=await startSSHFixture(base,{exec:({command,accept,reject})=>{if(command.includes('getent passwd')){const c=accept();c.write('1000\nfixture:x:1000:1000::/home/fixture:/bin/bash\n');c.exit(0);c.end();}else if(command==='/bin/true'){const c=accept();c.exit(0);c.end();}else reject();},shell:({accept})=>{const channel=accept();channel.write('appearance fixture\r\n$ ');channel.on('data',bytes=>{inputs.push(Buffer.from(bytes));channel.write(bytes);});}});
 let page=await launch();
 await page.setViewportSize({width:1120,height:760});await page.getByRole('button',{name:'Connect',exact:true}).click();const register=page.getByRole('button',{name:'서버 등록',exact:true});await register.scrollIntoViewIfNeeded();await expect(register).toBeInViewport({ratio:1});await page.screenshot({path:join(pictures,'minimum-connect.png')});await page.getByRole('button',{name:'Desktop',exact:true}).click();await page.setViewportSize({width:1600,height:1000});
 await page.evaluate(async port=>{const profile=await window.sshOS.profile.create({name:'Appearance fixture',host:'127.0.0.1',port,username:'fixture',authentication:'password'});await window.sshOS.session.connect(profile.id,{password:'test-only',saveSecret:false});},fixture.port);
 await page.getByRole('button',{name:'지문을 확인하고 연결'}).click();
 const home=page.locator('.desktop-home:visible');await expect(home.locator('.desktop-entry').first()).toBeVisible();
 const boxes=await home.locator('.desktop-entry').evaluateAll(nodes=>nodes.slice(0,2).map(node=>{const rect=node.getBoundingClientRect();return {x:rect.x,width:rect.width};}));assert.equal(boxes[1].x-boxes[0].x-boxes[0].width,24);
 await page.setViewportSize({width:1120,height:1000});await expect.poll(async()=>{const a=await home.locator('.desktop-entry').first().boundingBox(),b=await home.locator('.desktop-entry').nth(6).boundingBox();return b.y-a.y;}).toBe(144);await page.setViewportSize({width:1600,height:1000});await expect.poll(async()=>{const a=await home.locator('.desktop-entry').first().boundingBox(),b=await home.locator('.desktop-entry').nth(6).boundingBox();return b.y-a.y;}).toBe(0);
 await home.locator('.file-rows').evaluate(node=>{node.scrollTop=node.scrollHeight;});await expect(home.getByText('item-299.txt',{exact:true})).toBeVisible();await home.locator('.file-rows').evaluate(node=>{node.scrollTop=0;});
 await home.locator('.desktop-entry').filter({hasText:'projects'}).dblclick();const explorer=page.getByRole('region',{name:'파일 · Appearance fixture',exact:true});await expect(explorer.getByText('nested-00.txt',{exact:true})).toBeVisible();assert.equal((await explorer.locator('.file-row').first().boundingBox()).height,42);await explorer.locator('.file-row').first().click();
 await page.getByRole('button',{name:'Console',exact:true}).click();await expect(page.locator('.console-workspace:visible').getByText('입력 가능',{exact:true})).toBeVisible();
 const terminalId=await page.locator('.console-workspace:visible').getAttribute('data-terminal-window-id');assert.ok(terminalId);await page.locator('.console-workspace:visible .xterm-helper-textarea').focus();await page.keyboard.type('before-theme');await expect.poll(()=>Buffer.concat(inputs).toString()).toBe('before-theme');const sent=Buffer.concat(inputs).toString();assert.equal(fixture.metrics.shells,1);
 for(const theme of themes){
  await page.getByRole('button',{name:'Settings',exact:true}).click();const select=page.getByLabel('테마',{exact:true});await expect(select.locator('option')).toHaveCount(19);await select.selectOption(theme.id);
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme.id);await expect(page.locator('html')).toHaveAttribute('data-color-mode',theme.scheme);assert.equal((await page.evaluate(()=>window.sshOS.settings.get())).theme,theme.id);
  assert.equal(await page.locator('.desktop').evaluate(node=>getComputedStyle(node).backgroundColor),rgb(theme.colors.background));
  if(['chocolate','windows11','windows98','atom','dragonball'].includes(theme.id))await page.screenshot({path:join(pictures,`${theme.id}-settings.png`)});
  await page.getByRole('button',{name:'설정 닫기',exact:true}).click();
  await expect.poll(()=>page.locator('.console-workspace:visible .xterm-scrollable-element').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe(rgb(theme.colors.background));
  assert.equal(fixture.metrics.shells,1);assert.equal(Buffer.concat(inputs).toString(),sent);await expect(page.locator('.console-workspace:visible')).toHaveAttribute('data-terminal-window-id',terminalId);
  await page.getByRole('button',{name:'Desktop',exact:true}).click();await page.screenshot({path:join(pictures,`${theme.id}-desktop.png`)});await page.getByRole('button',{name:'Console',exact:true}).click();
  observations.push({theme:theme.id,appBackground:'pass',terminalBackground:'pass',sameTerminal:true});console.log(`Verified theme: ${theme.id}`);
  // Keep visual comparison human-paced and within the production IPC budget.
  await page.waitForTimeout(700);
 }
 await page.getByRole('button',{name:'새 표시 시작',exact:true}).click();await expect(page.locator('.console-workspace:visible').getByText('입력 가능',{exact:true})).toBeVisible();await expect.poll(()=>page.locator('.console-workspace:visible .xterm-scrollable-element').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe(rgb(themes.at(-1).colors.background));assert.equal(fixture.metrics.shells,1);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('테마',{exact:true}).selectOption('ubuntu');await expect(page.locator('html')).toHaveAttribute('data-theme','ubuntu');await page.getByRole('button',{name:'설정 닫기',exact:true}).click();
 await page.reload();await page.getByTestId('engine-state').filter({hasText:'연결 엔진 준비됨'}).waitFor();await expect(page.locator('html')).toHaveAttribute('data-theme','ubuntu');await expect(page.locator('.console-workspace:visible').getByText('입력 가능',{exact:true})).toBeVisible();assert.equal(fixture.metrics.shells,1);
 await closeTestApplication(application);application=null;page=await launch();await expect(page.locator('html')).toHaveAttribute('data-theme','ubuntu');assert.equal(fixture.metrics.shells,1);assert.ok(!(await page.evaluate(()=>window.sshOS.session.list())).sessions.some(row=>row.status==='connected'));
 await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByLabel('테마',{exact:true})).toHaveValue('ubuntu');
 const rejected=await page.evaluate(async()=>{try{await window.sshOS.settings.setTheme('untrusted-theme');return false;}catch{return true;}});assert.equal(rejected,true);
 await application.evaluate(()=>{const fs=process.getBuiltinModule('node:fs/promises'),path=process.getBuiltinModule('node:path'),native=fs.rename;fs.rename=async(source,destination)=>{if(path.basename(destination)==='state.json')throw Object.assign(new Error('fixture write failure'),{code:'EIO'});return native(source,destination);};});
 await page.getByLabel('테마',{exact:true}).selectOption('sky');await expect(page.locator('.error-panel')).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-theme','ubuntu');assert.equal((await page.evaluate(()=>window.sshOS.settings.get())).theme,'ubuntu');
 const report={status:'pass',themes:observations,checks:['minimum-size registration remains reachable','24px desktop cell gap','width-only resize reflows desktop cells','virtual desktop scroll reaches final entry','42px explorer rows','all19 palettes apply to app and retained xterm','no input injection or PTY recreation','renderer reload and full app restart preserve theme','restart does not reconnect SSH','unknown ID rejected','failed JSON write preserves acknowledged theme'],limitation:'Current-host Electron/loopback fixture; no native target accessibility, IME, scaling or real OpenSSH acceptance.'};await fs.writeFile(join(pictures,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){if(application){const page=await application.firstWindow();await page.screenshot({path:join(pictures,'failure.png')}).catch(()=>{});}throw error;}finally{if(application)await closeTestApplication(application);if(fixture)await fixture.close();await fs.rm(base,{recursive:true,force:true});await fs.rm(env.SSHOS_RUNTIME_ROOT,{recursive:true,force:true});}
