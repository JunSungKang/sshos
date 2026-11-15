import { realpath } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute, sep } from 'node:path';

export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; worker-src 'self'; form-action 'none'";

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png'
};

export function isAppOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'app:' && url.hostname === 'ui' && !url.port && !url.username && !url.password;
  } catch { return false; }
}

export function assetName(raw: string): string {
  if (!isAppOrigin(raw)) throw new Error('ASSET_DENIED');
  // Check before URL normalization can erase dot segments.
  const rawPath = raw.replace(/^app:\/\/[^/]+/, '').split(/[?#]/, 1)[0] ?? '';
  const decoded = decodeURIComponent(rawPath);
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(s => s === '.' || s === '..')) throw new Error('ASSET_DENIED');
  const path = new URL(raw).pathname;
  return path === '/' || path === '' ? 'index.html' : decodeURIComponent(path).replace(/^\//, '');
}

export async function resolveAsset(root: string, raw: string): Promise<{ path: string; mime: string }> {
  const canonicalRoot = await realpath(root);
  const name = assetName(raw);
  const path = await realpath(resolve(canonicalRoot, name));
  const rel = relative(canonicalRoot, path);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('ASSET_DENIED');
  const mime = mimeTypes[extname(path)];
  if (!mime) throw new Error('ASSET_DENIED');
  return { path, mime };
}

export class RequestBudget {
  private tokens:number;
  private at: number;
  constructor(private readonly clock: () => number = () => performance.now(),private readonly capacity=60,private readonly perSecond=30) { this.at = clock();this.tokens=capacity; }
  take(): boolean {
    const now = this.clock();
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.at) * this.perSecond / 1000);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}
