import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
export function localPath(name) {
  const path = resolve(root, '.local', name);
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Workspace path required');
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const ancestorRel = relative(root, realpathSync(ancestor));
  if (isAbsolute(ancestorRel) || ancestorRel === '..' || ancestorRel.startsWith(`..${sep}`)) throw new Error('Workspace parent symlink escape');
  mkdirSync(path, { recursive: true });
  const actual = realpathSync(path);
  const realRel = relative(root, actual);
  if (isAbsolute(realRel) || realRel === '..' || realRel.startsWith(`..${sep}`)) throw new Error('Workspace symlink escape');
  return actual;
}
export function runtimeEnvironment(name) {
  const env = { ...process.env, SSHOS_RUNTIME_ROOT: localPath(`runtime/${name}`), TMPDIR: localPath('tmp'), npm_config_cache: localPath('npm-cache'), electron_config_cache: localPath('electron-cache'), PLAYWRIGHT_BROWSERS_PATH: localPath('playwright'), ELECTRON_BUILDER_CACHE: localPath('builder-cache') };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

// Teardown chooses the product shutdown action in this owned test process.
export async function closeTestApplication(application){await application.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});}).catch(()=>{});await application.close();}
