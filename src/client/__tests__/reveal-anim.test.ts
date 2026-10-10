import { describe, expect, it } from 'vitest';
import { REVEAL_FLIP_MS, REVEAL_FLY_MS, REVEAL_TOTAL_MS, decideRevealAnim } from '../revealAnim';

describe('公开结算动画触发逻辑', () => {
  const cards = [{ id: 'a' }];

  it('首次出现新结算时播放', () => {
    expect(decideRevealAnim(null, { round: 1, cards }, false)).toEqual({ seen: 1, play: true });
  });

  it('同一轮只播一次（重渲染 / 换视角不重播）', () => {
    expect(decideRevealAnim(1, { round: 1, cards }, false)).toEqual({ seen: 1, play: false });
  });

  it('新一轮结算再次播放', () => {
    expect(decideRevealAnim(1, { round: 2, cards }, false)).toEqual({ seen: 2, play: true });
  });

  it('无人出牌（没有牌可翻）不播', () => {
    expect(decideRevealAnim(1, { round: 2, cards: [] }, false)).toEqual({ seen: null, play: false });
  });

  it('结算被清空（重开一局）时复位去重记录', () => {
    expect(decideRevealAnim(2, null, false)).toEqual({ seen: null, play: false });
  });

  it('减弱动效时只消费轮次、不播', () => {
    expect(decideRevealAnim(null, { round: 3, cards }, true)).toEqual({ seen: 3, play: false });
  });

  it('时长常量为前 3 秒 + 后 2 秒', () => {
    expect([REVEAL_FLIP_MS, REVEAL_FLY_MS, REVEAL_TOTAL_MS]).toEqual([3000, 2000, 5000]);
  });
});