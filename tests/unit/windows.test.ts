import { describe, expect, it } from 'vitest';
import { WindowManager, resizeBounds } from '../../src/shared/windows';
const area = { x: 0, y: 44, width: 1600, height: 840 };
describe('desktop window state and ownership', () => {
  it('preserves bounds and maximize state through minimize and restore', () => {
    const manager = new WindowManager(area); const file = manager.open('files');
    manager.moveResize(file.windowId, { x: 80, y: 90, width: 800, height: 500 });
    manager.toggleMaximize(file.windowId); manager.minimize(file.windowId); manager.restore(file.windowId);
    expect(manager.snapshot()[0]?.mode).toBe('maximized'); manager.toggleMaximize(file.windowId);
    expect(manager.snapshot()[0]?.bounds).toEqual({ x: 80, y: 90, width: 800, height: 500 });
  });
  it('clamps all windows after viewport shrink and respects reserved chrome', () => {
    const manager = new WindowManager(area); const first = manager.open('settings');
    manager.moveResize(first.windowId, { x: 1500, y: -500, width: 4000, height: 4000 });
    manager.resizeArea({ x: 0, y: 44, width: 1120, height: 600 });
    const bounds = manager.snapshot()[0]!.bounds; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBe(44); expect(bounds.x+bounds.width).toBeLessThanOrEqual(1120); expect(bounds.y+bounds.height).toBeLessThanOrEqual(644);
  });
  it('enforces singleton, file and viewer limits without evicting existing work', () => {
    const manager = new WindowManager(area); const connection = manager.open('connections');
    expect(manager.open('connections').windowId).toBe(connection.windowId);
    for (let i=0;i<6;i++) manager.open('files'); expect(() => manager.open('files')).toThrow('WINDOW_LIMIT');
    for (let i=0;i<4;i++) manager.open('text', null, null, `file${i}`); expect(() => manager.open('image', null, null, 'other')).toThrow('WINDOW_LIMIT');
    expect(manager.snapshot()).toHaveLength(11);
  });
  it('does not reassign server identity on focus, close or restore', () => {
    const manager = new WindowManager(area); const a = manager.open('files', crypto.randomUUID(), 1); const b = manager.open('files', crypto.randomUUID(), 2);
    manager.minimize(a.windowId); manager.focus(b.windowId); manager.restore(a.windowId); manager.close(b.windowId);
    expect(manager.snapshot()[0]?.serverId).toBe(a.serverId); expect(manager.snapshot()[0]?.sessionGeneration).toBe(1);
  });
});

it('anchors the opposite edge while clamping north-west resizing', () => {
  const start = { x: 100, y: 100, width: 800, height: 500 };
  expect(resizeBounds(start, 'nw', 900, 900, 'files', area)).toEqual({ x: 260, y: 240, width: 640, height: 360 });
  expect(resizeBounds(start, 'nw', -900, -900, 'files', area)).toEqual({ x: 0, y: 44, width: 900, height: 556 });
});
