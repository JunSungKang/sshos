import { _electron as electron,expect } from '@playwright/test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {root,localPath,runtimeEnvironment,closeTestApplication} from './environment.mjs';
import {startSSHFixture} from './fixtures/ssh-server.mjs';
const base=localPath(`fixtures/v7-${randomUUID()}`),env=runtimeEnvironment(`v7-${randomUUID()}`);Object.assign(process.env,env);const {default:executablePath}=await import('electron');
let application,fixture;const inputs=[];
try{
 await fs.mkdir(join(base,'etc'),{recursive:true});await fs.writeFile(join(base,'etc/os-release'),'ID=ubuntu\nVERSION_ID=24.04\n');await fs.mkdir(join(base,'home/fixture/projects'),{recursive:true});await fs.writeFile(join(base,'home/fixture/readme.txt'),'Home fixture text');await fs.writeFile(join(base,'home/fixture/.secret'),'hidden');await fs.writeFile(join(base,'home/fixture/projects/nested.txt'),'Nested fixture');
 fixture=await startSSHFixture(base,{exec:({command,accept,reject})=>{if(command.includes('getent passwd')){const c=accept();c.write('1000\nfixture:x:1000:1000::/home/fixture:/bin/bash\n');c.exit(0);c.end();}else if(command==='/bin/true'){const c=accept();c.exit(0);c.end();}else reject();},shell:({accept})=>{const c=accept();c.write('fixture terminal\r\n$ ');c.on('data',bytes=>{inputs.push(Buffer.from(bytes));c.write(bytes);});}});
 application=await electron.launch({executablePath,args:[`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`,root],cwd:root,env,timeout:15000});const page=await application.firstWindow();page.setDefaultTimeout(15000);await page.setViewportSize({width:1600,height:1000});
 await page.getByTestId('engine-state').filter({hasText:'연결 엔진 준비됨'}).waitFor();
 await page.evaluate(async port=>{const profile=await window.sshOS.profile.create({name:'v7 fixture',host:'127.0.0.1',port,username:'fixture',authentication:'password'});await window.sshOS.session.connect(profile.id,{password:'test-only',saveSecret:false});},fixture.port);
 await page.getByRole('button',{name:'지문을 확인하고 연결'}).click();
 await expect.poll(()=>page.locator('.brand img').evaluate(img=>img.complete && img.naturalWidth>0)).toBe(true);const home=page.locator('.desktop-home:visible');await expect(home.locator('.desktop-entry')).toHaveCount(2);await expect(home.getByText('projects',{exact:true})).toBeVisible();await expect(home.getByText('.secret',{exact:true})).toHaveCount(0);
 await home.locator('.desktop-entry').filter({hasText:'projects'}).dblclick();await expect(page.locator('.internal-window:visible').getByText('nested.txt',{exact:true})).toBeVisible();
 await page.screenshot({path:join(localPath('evidence'),'v7-desktop.png')});const palette=await page.locator('.desktop').evaluate(node=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color}));assert.deepEqual(palette,{background:'rgb(33, 26, 22)',color:'rgb(232, 223, 210)'});
 await page.getByRole('button',{name:'Settings',exact:true}).click();const checkbox=page.getByRole('checkbox',{name:'숨김파일 보기'});await checkbox.click();await expect(checkbox).toBeChecked();await expect.poll(()=>page.evaluate(async()=>(await window.sshOS.settings.get()).showHiddenFiles)).toBe(true);await page.getByRole('button',{name:'설정 닫기',exact:true}).click();await expect(home.locator('.desktop-entry')).toHaveCount(3);
 await page.getByRole('button',{name:'Console',exact:true}).click();await expect(page.locator('.console-workspace:visible').getByText('입력 가능',{exact:true})).toBeVisible();await expect.poll(()=>fixture.metrics.shells).toBe(1);
 const terminal=page.locator('.console-workspace:visible .xterm-helper-textarea');await terminal.focus();await page.keyboard.type('vi readme.txt');await page.keyboard.press('Enter');await expect.poll(()=>Buffer.concat(inputs).toString()).toContain('vi readme.txt');const sent=Buffer.concat(inputs).toString();
 for(let i=0;i<10;i++){await page.getByRole('button',{name:'Desktop',exact:true}).click();await page.getByRole('button',{name:'Console',exact:true}).click();}
 assert.equal(fixture.metrics.shells,1);assert.equal(Buffer.concat(inputs).toString(),sent);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('checkbox',{name:'숨김파일 보기'}).click();await expect(page.getByRole('checkbox',{name:'숨김파일 보기'})).not.toBeChecked();await page.getByRole('button',{name:'설정 닫기',exact:true}).click();assert.equal(fixture.metrics.shells,1);await page.screenshot({path:join(localPath('evidence'),'v7-console.png')});
 await page.getByRole('button',{name:'Desktop',exact:true}).click();await expect(home.locator('.desktop-entry')).toHaveCount(2);
 const status=page.locator('.sidebar-status');await expect(status).toContainText('v7 fixture');const bounds=await status.boundingBox();assert.ok(bounds.x<184 && bounds.y>700);
 console.log(JSON.stringify({status:'pass',checks:['actual home icon listing','folder opens correct explorer','hidden preference persists after ACK and updates all views','single PTY across 20 mode transitions','no injected/replayed commands','bottom-left server response status'],limitation:'Current host and loopback SSH; target native accessibility, real vi process, full transfer/fault matrix remain separate.'}));
} catch(error){if(application){const page=await application.firstWindow();console.error((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:join(localPath('evidence'),'v7-failure.png')}).catch(()=>{});}throw error;}finally{if(application)await closeTestApplication(application);if(fixture)await fixture.close();await fs.rm(base,{recursive:true,force:true});await fs.rm(env.SSHOS_RUNTIME_ROOT,{recursive:true,force:true});}
