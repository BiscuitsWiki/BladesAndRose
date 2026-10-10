import { describe, expect, it } from 'vitest';
import { applyMove, autoMoveFor, createGame, type GameState, type Role } from '../index';

const NAMES = ['A', 'B', 'C', 'D', 'E'];

/** 5 人局固定角色，方便精确控制 */
const ROLES_5: Record<number, Role> = {
  0: 'whiteRose',
  1: 'bishop',
  2: 'believer',
  3: 'doubleBlade',
  4: 'darkBlade',
};

function newGame(over: Parameters<typeof createGame>[1] = {}): GameState {
  return createGame(NAMES, {
    seed: 42,
    roles: ROLES_5,
    coinSeat: 0,
    crystals: { 0: 2 }, // 水晶 2 = 顺序公开，不产生任何出牌约束
    ...over,
  });
}

/** 确定性随机源：总取第一个候选 */
const first = () => 0;

describe('AI 托管（autoMoveFor）', () => {
  it('阶段一：托管座位替持币者传币，目标必须是水晶尚未放上版图的玩家', () => {
    const s = newGame();
    // p0 的水晶已放出（其他座位未放）：随机源取第一个候选，应落在 p1 而不是 p0
    s.players[0]!.crystalPlaced = true;
    s.crystalsPlaced = 1;

    const move = autoMoveFor(s, 'p0', first);
    expect(move).toEqual({ type: 'passCoin', playerId: 'p0', to: 'p1' });
  });

  it('阶段一：不是持币者的托管座位不产生动作', () => {
    const s = newGame();
    expect(autoMoveFor(s, 'p1', first)).toBeNull();
  });

  it('阶段一：传币动作可直接应用于引擎（水晶 2 无目标约束，进入出牌阶段）', () => {
    const s = newGame();
    const move = autoMoveFor(s, 'p0', first)!;
    const next = applyMove(s, move);
    expect(next.crystalTrack.at(-1)?.player).toBe('p0');
    expect(next.phase).toBe('play');
  });

  it('阶段一选目标：按技能的目标约束随机选取（水晶 1 = 指定一人必须出牌）', () => {
    let s = newGame({ crystals: { 0: 1 } });
    s = applyMove(s, { type: 'passCoin', playerId: 'p0', to: 'p0' });
    expect(s.phase).toBe('magicTargets');

    const move = autoMoveFor(s, 'p0', first);
    expect(move).toEqual({ type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1'] });
    const next = applyMove(s, move!);
    expect(next.phase).toBe('play');
    expect(next.modifiers.mustPlay).toEqual(['p1']);
  });

  it('阶段一选目标：需要两名目标的技能一次选足（水晶 5 = 行动绑定）', () => {
    let s = newGame({ crystals: { 0: 5 } });
    s = applyMove(s, { type: 'passCoin', playerId: 'p0', to: 'p0' });
    expect(s.phase).toBe('magicTargets');

    const move = autoMoveFor(s, 'p0', first);
    expect(move).toEqual({ type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1', 'p2'] });
    const next = applyMove(s, move!);
    expect(next.modifiers.pairs.length).toBe(1);
  });

  it('阶段二：轮到托管座位时一律跳过', () => {
    let s = newGame();
    s = applyMove(s, { type: 'passCoin', playerId: 'p0', to: 'p0' }); // 从 p0 起出牌

    const move = autoMoveFor(s, 'p0', first);
    expect(move).toEqual({ type: 'passTurn', playerId: 'p0' });
    const next = applyMove(s, move!);
    expect(next.passed['p0']).toBe(true);
  });

  it('阶段二：不是自己回合的托管座位不产生动作', () => {
    let s = newGame();
    s = applyMove(s, { type: 'passCoin', playerId: 'p0', to: 'p0' });
    expect(autoMoveFor(s, 'p1', first)).toBeNull();
  });

  it('阶段二：被规则强制出牌时无法跳过，改打手中第一张牌', () => {
    let s = newGame();
    s = applyMove(s, { type: 'passCoin', playerId: 'p0', to: 'p0' });
    s = { ...s, modifiers: { ...s.modifiers, mustPlay: ['p0'] } };

    const move = autoMoveFor(s, 'p0', first);
    expect(move?.type).toBe('playCard');
    const next = applyMove(s, move!);
    expect(next.played['p0']).not.toBeNull();
  });

  it('阶段二：10 号换牌挂起时打出第一张牌完成对调', () => {
    let s = newGame();
    s = applyMove(s, { type: 'passCoin', playerId: 'p0', to: 'p0' });
    const played = s.players[0]!.hand[0]!;
    s = applyMove(s, { type: 'playCard', playerId: 'p0', cardId: played.id });
    // 手工构造换牌挂起（10 号技能的效果由 magic 流程产生）
    s = { ...s, phase: 'play', pendingRedraw: 'p0', playOrder: ['p0'], turnIndex: 0 };

    const move = autoMoveFor(s, 'p0', first);
    expect(move?.type).toBe('playCard');
    const next = applyMove(s, move!);
    expect(next.pendingRedraw).toBeNull();
    expect(next.log.some((line) => line.includes('完成换牌'))).toBe(true);
  });

  it('阶段三：换牌阶段（10 号）放弃使用换牌', () => {
    let s = newGame();
    s = applyMove(s, { type: 'passCoin', playerId: 'p0', to: 'p0' }); // 拿到真实的出牌顺序
    const ready: GameState = {
      ...s,
      phase: 'redraw',
      modifiers: { ...s.modifiers, redrawOption: 'p0' },
    };

    const move = autoMoveFor(ready, 'p0', first);
    expect(move).toEqual({ type: 'resolveRedraw', playerId: 'p0' });
    const next = applyMove(ready, move!);
    expect(next.phase).toBe('play');
    expect(next.log.at(-1)).toContain('放弃使用换牌');
  });

  it('游戏结束后不再产生任何动作', () => {
    const s = newGame();
    const finished: GameState = { ...s, phase: 'finished', winner: 'whiteRose' };
    expect(autoMoveFor(finished, 'p0', first)).toBeNull();
  });
});