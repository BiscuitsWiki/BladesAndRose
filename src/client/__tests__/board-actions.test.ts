import { describe, expect, it } from 'vitest';
import { createGame, playerView, type GameView } from '../../engine';
import { canResolveRedraw, handActions } from '../boardActions';

/** 真实建一局并取一位玩家的视图，避免手工拼 GameView 字面量 */
function baseView(): GameView {
  return playerView(createGame(['A', 'B', 'C', 'D', 'E'], { seed: 7 }), 'p0');
}

/** 出牌阶段、轮到 p0 的局面；modifierOver 用来指定魔法约束 */
function viewInPlay(
  over: Partial<GameView> = {},
  modifierOver: Partial<GameView['modifiers']> = {},
): GameView {
  const base = baseView();
  return {
    ...base,
    phase: 'play',
    currentActor: 'p0',
    modifiers: { ...base.modifiers, ...modifierOver },
    ...over,
  };
}

describe('手牌区按钮逻辑（出牌阶段）', () => {
  it('轮到自己、出牌阶段时显示按钮，默认可跳过', () => {
    expect(handActions(viewInPlay(), 'p0', null)).toEqual({
      canGoLast: false,
      canConfirm: false,
      canSkip: true,
    });
  });

  it('不是自己的回合时不显示', () => {
    expect(handActions(viewInPlay({ currentActor: 'p1' }), 'p0', null)).toBeNull();
  });

  it('观战者（未取座）不显示', () => {
    expect(handActions(viewInPlay(), null, null)).toBeNull();
  });

  it('非出牌阶段不显示', () => {
    for (const phase of ['magic', 'magicTargets', 'redraw', 'finished'] as const) {
      expect(handActions(viewInPlay({ phase }), 'p0', null)).toBeNull();
    }
  });

  it('持有殿后权且未使用时才出现「我要最后行动」', () => {
    expect(handActions(viewInPlay({}, { goLastOption: 'p0' }), 'p0', null)?.canGoLast).toBe(true);
    expect(
      handActions(viewInPlay({}, { goLastOption: 'p0', goLastUsed: true }), 'p0', null)?.canGoLast,
    ).toBe(false);
    // 殿后权属于别人时不出现
    expect(handActions(viewInPlay({}, { goLastOption: 'p1' }), 'p0', null)?.canGoLast).toBe(false);
  });

  it('选中手牌后出现「确认 / 取消」，并隐藏「我要最后行动」', () => {
    const ops = handActions(viewInPlay({}, { goLastOption: 'p0' }), 'p0', 'card#1');
    expect(ops).toEqual({ canGoLast: false, canConfirm: true, canSkip: true });
  });

  it('被强制出牌时「跳过」禁用，但殿后仍可选', () => {
    const ops = handActions(viewInPlay({}, { mustPlay: ['p0'], goLastOption: 'p0' }), 'p0', null);
    expect(ops).toEqual({ canGoLast: true, canConfirm: false, canSkip: false });
  });

  it('被强制跳过时「跳过」仍可点（禁用的是手牌）', () => {
    const ops = handActions(viewInPlay({}, { mustPass: ['p0'] }), 'p0', null);
    expect(ops?.canSkip).toBe(true);
  });

  it('10 号换牌挂起时：跳过与殿后都不可用，仍可选中手牌确认', () => {
    const idle = handActions(viewInPlay({ pendingRedraw: 'p0' }, { goLastOption: 'p0' }), 'p0', null);
    expect(idle).toEqual({ canGoLast: false, canConfirm: false, canSkip: false });
    const picked = handActions(viewInPlay({ pendingRedraw: 'p0' }), 'p0', 'card#1');
    expect(picked?.canConfirm).toBe(true);
  });
});

describe('玩家区按钮逻辑', () => {
  it('出牌阶段玩家区不再有任何按钮（跳过已移入手牌区）', () => {
    expect(canResolveRedraw(viewInPlay(), 'p0')).toBe(false);
  });

  it('换牌阶段轮到决策者时显示「放弃换牌」', () => {
    const view = viewInPlay({ phase: 'redraw' });
    expect(canResolveRedraw(view, 'p0')).toBe(true);
    expect(canResolveRedraw(view, 'p1')).toBe(false);
  });

  it('观战者看不到任何按钮', () => {
    expect(canResolveRedraw(viewInPlay(), null)).toBe(false);
  });
});