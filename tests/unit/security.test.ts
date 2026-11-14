import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assetName, isAppOrigin, RequestBudget, resolveAsset } from '../../src/main/security';

const owned: string[] = [];
afterEach(async () => { for (const path of owned.splice(0)) await rm(path, { recursive: true }); });
describe('package asset boundary', () => {
  it.each(['https://ui/', 'app://ui.evil/', 'file:///etc/passwd', 'app://user@ui/', 'app://ui:99/'])('rejects foreign origin %s', input => expect(isAppOrigin(input)).toBe(false));
  it.each(['app://ui/../secret', 'app://ui/%2e%2e/secret', 'app://ui/a/%2e/secret', 'app://ui/%5csecret', 'app://ui/%00', 'app://ui/%ZZ'])('rejects unsafe raw paths %s', input => expect(() => assetName(input)).toThrow());
  it('resolves packaged files but refuses symlink escape and unknown MIME', async () => {
    const tmp = resolve('.local/tmp'); await mkdir(tmp, { recursive: true });
    const dir = await mkdtemp(resolve(tmp, 'asset-test-')); owned.push(dir);
    const packageRoot = resolve(dir, 'ui'); await mkdir(packageRoot);
    await writeFile(resolve(packageRoot, 'index.html'), '<html></html>');
    await writeFile(resolve(dir, 'secret.js'), 'secret');
    await writeFile(resolve(packageRoot, 'private.txt'), 'secret');
    await symlink(resolve(dir, 'secret.js'), resolve(packageRoot, 'escape.js'));
    expect((await resolveAsset(packageRoot, 'app://ui/')).mime).toContain('text/html');
    await expect(resolveAsset(packageRoot, 'app://ui/escape.js')).rejects.toThrow('ASSET_DENIED');
    await expect(resolveAsset(packageRoot, 'app://ui/private.txt')).rejects.toThrow('ASSET_DENIED');
  });
});
describe('renderer IPC control budget', () => {
  it('allows bounded burst and replenishes at 30 per second', () => {
    let now = 0; const budget = new RequestBudget(() => now);
    for (let i = 0; i < 60; i++) expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false); now = 1000;
    for (let i = 0; i < 30; i++) expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
  });
});
