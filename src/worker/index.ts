import { Client } from 'ssh2';
import { z } from 'zod';

const epoch = z.uuid().parse(process.argv[2]);
if (!process.parentPort) throw new Error('Utility process parent port required');
// Loading the SSH implementation proves runtime linkage without connecting anywhere.
if (typeof Client !== 'function') throw new Error('SSH implementation unavailable');
process.parentPort.postMessage({ type: 'ready', backendEpoch: epoch, sshLibrary: 'ssh2' });
process.parentPort.on('message', () => { /* No network operations exposed in the foundation milestone. */ });
