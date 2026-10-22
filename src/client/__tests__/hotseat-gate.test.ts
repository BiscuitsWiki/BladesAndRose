import { describe, expect, it } from 'vitest';
import { distributionSignature, type Distribution } from '../../engine';
import { parseHash, resolveHotseatDebug } from '../debug';

describe('热座调试门控', () => {
  it('开关默认跟随 dev，override 优先', () => {
    expect(resolveHotseatDebug({ dev: true })).toBe(true);
    expect(resolveHotseatDebug({ dev: false })).toBe(false);
    expect(resolveHotseatDebug({ dev: false, override: true })).toBe(true);
    expect(resolveHotseatDebug({ dev: true, override: false })).toBe(false);
  });

  it('调试关闭时热座 hash（无 room）判为无效，回落大厅', () => {
    const state = parseHash('#players=5&seat=0', false);
    expect(state.valid).toBe(false);
    expect(state.room).toBeNull();
  });

  it('调试开启时热座 hash 正常直入', () => {
    const state = parseHash('#players=5&seat=0', true);
    expect(state.valid).toBe(true);
    expect(state.room).toBeNull();
    expect(state.seat).toBe('0');
  });

  it('带 room 的联机 hash 不受开关影响', () => {
    for (const debug of [true, false]) {
      const state = parseHash('#players=6&seat=2&room=TEST1', debug);
      expect(state.valid).toBe(true);
      expect(state.room).toBe('TEST1');
      expect(state.seat).toBe('2');
    }
  });

  it('观战 hash（spectate=1 且带 room）不受开关影响', () => {
    for (const debug of [true, false]) {
      const state = parseHash('#players=6&spectate=1&room=TEST1', debug);
      expect(state.valid).toBe(true);
      expect(state.seat).toBeNull();
      expect(state.room).toBe('TEST1');
    }
  });

  it('自定义配比的热座 hash 在调试关闭时同样被拒', () => {
    // 5 人局自定义配比（合计 5、白蔷薇/暗刃各 1）
    const custom: Distribution = { whiteRose: 1, bishop: 0, believer: 2, doubleBlade: 0, greatBlade: 1, darkBlade: 1 };
    const hash = `#players=5&seat=0&d=${distributionSignature(custom)}`;
    const off = parseHash(hash, false);
    expect(off.dist).not.toBeNull(); // 配比本身合法，拒绝只因热座调试关闭
    expect(off.valid).toBe(false);
    expect(parseHash(hash, true).valid).toBe(true);
  });

  it('lobby=1 逃生阀两种开关下均生效', () => {
    for (const debug of [true, false]) {
      expect(parseHash('#lobby=1', debug).forceLobby).toBe(true);
    }
  });
});
