import { _electron as electron } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { root,localPath,runtimeEnvironment } from './environment.mjs';
import { startSSHFixture } from './fixtures/ssh-server.mjs';

function crc(bytes) {let value=0xffffffff;for (const byte of bytes) {value^=byte;for (let bit=0;bit<8;bit++) value=value&1 ? (value>>>1)^0xedb88320 : value>>>1;}return (value^0xffffffff)>>>0;}
function chunk(name,data) {const prefix=Buffer.alloc(8);prefix.writeUInt32BE(data.length);prefix.write(name,4);const sum=Buffer.alloc(4);sum.writeUInt32BE(crc(Buffer.concat([Buffer.from(name),data])));return Buffer.concat([prefix,data,sum]);}
function png(width,height,quadrants=false,noise=false) {const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const row=width*4+1;const pixels=Buffer.alloc(row*height);let seed=0x12345678;const random=() => {seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>24;};for (let y=0;y<height;y++) for (let x=0;x<width;x++) {const p=y*row+x*4+1;const color=noise ? [random(),random(),random()] : quadrants ? [[227,0,0],[0,160,0],[0,0,227],[227,227,0]][Number(y>=height/2)*2+Number(x>=width/2)] : [8,127,120];pixels[p]=color[0];pixels[p+1]=color[1];pixels[p+2]=color[2];pixels[p+3]=255;}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
const fixtureRoot=localPath(`fixtures/viewers-${randomUUID()}`);const env=runtimeEnvironment(`viewers-${randomUUID()}`);Object.assign(process.env,env);
const {default:executablePath}=await import('electron');let application,fixture;
try {
  await fs.mkdir(join(fixtureRoot,'etc'),{recursive:true});await fs.mkdir(join(fixtureRoot,'home/fixture'),{recursive:true});
  await fs.writeFile(join(fixtureRoot,'etc/os-release'),'ID=ubuntu\nVERSION_ID=24.04\n');
  const text=Array.from({length:5000},(_,i) => `line ${i} 한글 <script>window.viewerSentinel=true</script> \u001b[31m`).join('\r\n');
  await fs.writeFile(join(fixtureRoot,'home/fixture/notes.txt'),text);await fs.writeFile(join(fixtureRoot,'home/fixture/picture.data'),png(280,180));await fs.writeFile(join(fixtureRoot,'home/fixture/unknown.bin'),'read as plain text\n');
  fixture=await startSSHFixture(fixtureRoot);
  application=await electron.launch({executablePath,args:[`--user-data-dir=${env.SSHOS_RUNTIME_ROOT}`,root],cwd:root,env,timeout:15000});
  const page=await application.firstWindow();page.setDefaultTimeout(15000);
  await page.getByTestId('engine-state').filter({hasText:'연결 엔진 준비됨'}).waitFor();assert.equal(await page.evaluate(() => typeof ArrayBuffer.prototype.transfer),'function');
  const jpegBase=Buffer.from(await application.evaluate(({nativeImage},data) => nativeImage.createFromBuffer(Buffer.from(data,'base64')).toJPEG(100).toString('base64'),png(80,60,true).toString('base64')),'base64');
  for (let n=1;n<=8;n++) {const tiff=Buffer.alloc(26);tiff.write('II');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x112,10);tiff.writeUInt16LE(3,12);tiff.writeUInt32LE(1,14);tiff.writeUInt16LE(n,18);const payload=Buffer.concat([Buffer.from('Exif\0\0'),tiff]);const prefix=Buffer.from([255,225,0,0]);prefix.writeUInt16BE(payload.length+2,2);await fs.writeFile(join(fixtureRoot,`home/fixture/oriented-${n}.jpg`),Buffer.concat([jpegBase.subarray(0,2),prefix,payload,jpegBase.subarray(2)]));}
  const webp=await page.evaluate(() => {const c=document.createElement('canvas');c.width=80;c.height=60;const context=c.getContext('2d');context.fillStyle='#087f78';context.fillRect(0,0,80,60);return c.toDataURL('image/webp',1).split(',')[1];});await fs.writeFile(join(fixtureRoot,'home/fixture/static.webp'),Buffer.from(webp,'base64'));
  await fs.writeFile(join(fixtureRoot,'home/fixture/bad.txt'),Buffer.from([255,254,1]));
  const large=png(1024,1024,false,true);assert.ok(large.length>3*1024*1024);await fs.writeFile(join(fixtureRoot,'home/fixture/large.png'),large);
  const profileId=await page.evaluate(async port => {const profile=await window.sshOS.profile.create({name:'Viewer 검사',host:'127.0.0.1',port,username:'fixture',authentication:'password'});await window.sshOS.session.connect(profile.id,{password:'test-only',saveSecret:false});return profile.id;},fixture.port);
  await page.getByRole('button',{name:'지문을 확인하고 연결'}).click();await page.waitForFunction(async () => (await window.sshOS.session.list()).sessions.some(row => row.status === 'connected' && row.sftp === 'available'));
  await page.getByRole('navigation',{name:'앱 실행'}).getByRole('button',{name:'파일',exact:true}).dblclick();
  const explorer=page.getByRole('region',{name:'파일 · Viewer 검사',exact:true});
  await explorer.getByRole('listitem').filter({hasText:'notes.txt'}).dblclick();
  const textWindow=page.getByRole('region',{name:'텍스트 / notes.txt · Viewer 검사',exact:true});
  await textWindow.getByLabel('뷰어 읽기 상태').filter({hasText:'읽기 전용'}).waitFor();
  const textBody=textWindow.getByRole('textbox',{name:'텍스트 내용'});assert.ok((await textBody.textContent()).includes('line 0 한글 <script>'));assert.ok((await textBody.textContent()).includes('\u001b[31m'));assert.equal(await textWindow.locator('script').count(),0);assert.equal(await page.evaluate(() => window.viewerSentinel),undefined);
  await textBody.evaluate(element => {element.scrollTop=1200;});const scroll=await textBody.evaluate(element => element.scrollTop);
  await page.getByRole('button',{name:'텍스트 / notes.txt · Viewer 검사 최소화',exact:true}).click();await page.locator('.taskbar').getByRole('button',{name:'≡ notes.txt',exact:true}).click();assert.equal(await textBody.evaluate(element => element.scrollTop),scroll);
  await fs.writeFile(join(fixtureRoot,'home/fixture/notes.txt'),'manual reread only\n');
  await textWindow.getByRole('button',{name:'다시 읽기',exact:true}).click();await textBody.getByText('manual reread only',{exact:true}).waitFor();
  await page.locator('.taskbar').getByRole('button',{name:'▱ 파일',exact:true}).click();
  await explorer.getByRole('listitem').filter({hasText:'picture.data'}).dblclick();
  const imageWindow=page.getByRole('region',{name:'이미지 / picture.data · Viewer 검사',exact:true});await imageWindow.getByLabel('뷰어 읽기 상태').filter({hasText:'읽기 전용'}).waitFor();
  const canvas=imageWindow.getByRole('img');assert.equal(await canvas.getAttribute('width'),'280');assert.equal(await canvas.getAttribute('height'),'180');
  const pixel=await canvas.evaluate(async element => {const bitmap=await createImageBitmap(element);const copy=new OffscreenCanvas(1,1);const context=copy.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return [...context.getImageData(0,0,1,1).data];});assert.deepEqual(pixel,[8,127,120,255]);
  const opensBeforeZoom=fixture.metrics.openedPaths.length;await imageWindow.getByLabel('이미지 배율').selectOption('200');assert.equal(await canvas.evaluate(element => Number.parseFloat(getComputedStyle(element).width)),560);assert.equal(fixture.metrics.openedPaths.length,opensBeforeZoom);
  await page.screenshot({path:join(localPath('evidence'),'d06-viewers.png')});
  await page.locator('.taskbar').getByRole('button',{name:'▱ 파일',exact:true}).click();
  for (let n=1;n<=8;n++) {
    await page.locator('.taskbar').getByRole('button',{name:'▱ 파일',exact:true}).click();await explorer.getByRole('listitem').filter({hasText:`oriented-${n}.jpg`}).dblclick();
    const image=page.getByRole('region',{name:`이미지 / oriented-${n}.jpg · Viewer 검사`,exact:true});await image.getByLabel('뷰어 읽기 상태').filter({hasText:'읽기 전용'}).waitFor();const canvas=image.getByRole('img');assert.equal(await canvas.getAttribute('width'),String(n>=5 ? 60 : 80));assert.equal(await canvas.getAttribute('height'),String(n>=5 ? 80 : 60));
    const rgb=await canvas.evaluate(async element => {const bitmap=await createImageBitmap(element);const copy=new OffscreenCanvas(1,1);const context=copy.getContext('2d');context.drawImage(bitmap,-5,-5);bitmap.close();return [...context.getImageData(0,0,1,1).data];});
    const category=rgb[0]>150 && rgb[1]>150 && rgb[2]<50 ? 'yellow' : rgb[0]>150 && rgb[1]<50 ? 'red' : rgb[1]>100 && rgb[0]<50 ? 'green' : rgb[2]>150 && rgb[0]<50 ? 'blue' : 'unknown';assert.equal(category,['red','green','yellow','blue','red','blue','yellow','green'][n-1]);
    await page.getByRole('button',{name:`이미지 / oriented-${n}.jpg · Viewer 검사 닫기`,exact:true}).click();
  }
  await page.locator('.taskbar').getByRole('button',{name:'▱ 파일',exact:true}).click();await explorer.getByRole('listitem').filter({hasText:'static.webp'}).dblclick();const webpWindow=page.getByRole('region',{name:'이미지 / static.webp · Viewer 검사',exact:true});await webpWindow.getByLabel('뷰어 읽기 상태').filter({hasText:'읽기 전용'}).waitFor();assert.equal(await webpWindow.getByRole('img').getAttribute('width'),'80');await page.getByRole('button',{name:'이미지 / static.webp · Viewer 검사 닫기',exact:true}).click();
  await page.locator('.taskbar').getByRole('button',{name:'▱ 파일',exact:true}).click();await explorer.getByRole('listitem').filter({hasText:'large.png'}).dblclick();const largeWindow=page.getByRole('region',{name:'이미지 / large.png · Viewer 검사',exact:true});await largeWindow.getByLabel('뷰어 읽기 상태').filter({hasText:'읽기 전용'}).waitFor();assert.equal(await largeWindow.getByRole('img').getAttribute('width'),'1024');await page.getByRole('button',{name:'이미지 / large.png · Viewer 검사 닫기',exact:true}).click();
  await page.locator('.taskbar').getByRole('button',{name:'▱ 파일',exact:true}).click();await explorer.getByRole('listitem').filter({hasText:'bad.txt'}).dblclick();const invalid=page.getByRole('region',{name:'텍스트 / bad.txt · Viewer 검사',exact:true});await invalid.getByRole('alert').filter({hasText:'지원하는 정적 이미지 형식'}).waitFor();await fs.writeFile(join(fixtureRoot,'home/fixture/bad.txt'),'fixed text\n');await invalid.getByRole('button',{name:'다시 읽기',exact:true}).click();await invalid.getByRole('textbox',{name:'텍스트 내용'}).getByText('fixed text',{exact:true}).waitFor();await page.getByRole('button',{name:'텍스트 / bad.txt · Viewer 검사 닫기',exact:true}).click();
  await page.locator('.taskbar').getByRole('button',{name:'▱ 파일',exact:true}).click();
  await explorer.getByRole('listitem').filter({hasText:'unknown.bin'}).dblclick();
  await page.getByRole('dialog',{name:'파일 열기 형식 선택'}).getByRole('button',{name:'텍스트로 열기',exact:true}).click();
  const selectedText=page.getByRole('region',{name:'텍스트 / unknown.bin · Viewer 검사',exact:true});await selectedText.getByRole('textbox',{name:'텍스트 내용'}).getByText('read as plain text',{exact:true}).waitFor();
  await page.evaluate(id => window.sshOS.session.disconnect(id),profileId);await selectedText.getByText('연결 끊김 · 마지막 표시 내용을 읽기 전용으로 유지합니다.',{exact:false}).waitFor();assert.equal(await selectedText.getByRole('button',{name:'다시 읽기',exact:true}).isDisabled(),true);
  const report={status:'pass',platform:process.platform,architecture:process.arch,assertions:['actual Electron SSH/SFTP text read through restricted preload','HTML and ANSI source as plain text','virtual text and scroll restoration','explicit reread updates content','PNG signature despite unknown extension','isolated Worker decode to one bitmaprenderer canvas','pixel correctness and zoom without remote reread','JPEG EXIF orientations1–8 with dimensions and corner pixels','static WebP decode','multi-MiB PNG stream paced within IPC budget','invalid UTF8 refusal and successful explicit reread','unknown file explicit text selection','disconnected viewer cache and disabled reread'],limitation:'Current macOS arm64 development build with local ssh2 fixture; not target OS, Ubuntu/OpenSSH or signed release acceptance.'};
  await fs.writeFile(join(localPath('evidence'),'d06-viewers.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {if (application) await application.close();if (fixture) await fixture.close();await fs.rm(fixtureRoot,{recursive:true,force:true});await fs.rm(env.SSHOS_RUNTIME_ROOT,{recursive:true,force:true});}
