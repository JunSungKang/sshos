import { parentPort, workerData } from 'node:worker_threads';
import { createPrivateKey } from 'node:crypto';
import { utils } from 'ssh2';
import { inspectPrivateKey } from './key-policy';

const input = workerData as { bytes: Uint8Array; passphrase?: string };
const bytes = Buffer.from(input.bytes);
try {
  inspectPrivateKey(bytes);
  if (input.passphrase !== undefined && Buffer.byteLength(input.passphrase, 'utf8') > 1024) throw new Error('KEY_INVALID');
  const parsed = utils.parseKey(bytes, input.passphrase);
  if (parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey()) throw new Error('KEY_INVALID');
  if (parsed.type !== 'ssh-rsa' && parsed.type !== 'ssh-ed25519') throw new Error('AUTH_UNSUPPORTED');
  const key = createPrivateKey(parsed.getPrivatePEM());
  if (key.asymmetricKeyType === 'rsa' && (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('KEY_INVALID');
  const privatePEM = key.export({ type: 'pkcs8', format: 'pem' }).toString();
  parentPort?.postMessage({ ok: true, privatePEM, publicSSH: `${parsed.type} ${parsed.getPublicSSH().toString('base64')}` });
} catch (error) {
  parentPort?.postMessage({ ok: false, code: error instanceof Error && error.message === 'AUTH_UNSUPPORTED' ? 'AUTH_UNSUPPORTED' : 'KEY_INVALID' });
} finally { bytes.fill(0); parentPort?.close(); }
