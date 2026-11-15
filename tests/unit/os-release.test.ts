import { expect, it } from 'vitest';
import { identifyOS } from '../../src/worker/connection/os-release';
it('only identifies declared supported Ubuntu and never evaluates shell syntax', () => {
  expect(identifyOS(Buffer.from('ID=ubuntu\nVERSION_ID="24.04"\n'))).toBe('supported');
  expect(identifyOS(Buffer.from('ID=debian\nVERSION_ID=12\n'))).toBe('unsupported');
  expect(identifyOS(Buffer.from('ID=ubuntu\nID=evil\nVERSION_ID=24.04'))).toBe('unknown');
  expect(identifyOS(Buffer.from('ID=$(anything)\nVERSION_ID=24.04'))).toBe('unknown');
  expect(identifyOS(Buffer.alloc(16385))).toBe('unknown');
  expect(identifyOS(Buffer.from([0xff]))).toBe('unknown');
});
