import { INVALID_MOVE } from 'boardgame.io/core';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import {
  SKILLS,
  applyMoveInPlace,
  createGame,
  currentActor,
  playerById,
  type Distribution,
  type GameState,
  type GameView,
  type Move,
} from '../../engine';
import { BladesAndRose, distributionOfGameName, gameNameOf } from '../game';

const NAMES = ['A', 'B', 'C', 'D', 'E'];

const setup = BladesAndRose.setup as unknown as (context: {
  ctx: { numPlayers: number };
}) => GameState;

type MoveFnLike = (context: { G: GameState; ctx: unknown; playerID: string }, ...args: never[]) => unknown;

/** move 允许写成短函数式或 long-form（{ move, noLimit, client }），这里统一取出可调用函数 */
const moves = Object.fromEntries(
  Object.entries(BladesAndRose.moves as unknown as Record<string, unknown>).map(([name, entry]) => [
    name,
    typeof entry === 'function' ? entry : (entry as { move: unknown }).move,
  ]),
) as Record<string, MoveFnLike>;

const viewOf = BladesAndRose.playerView as unknown as (context: {
  G: GameState;
  ctx: unknown;
  playerID: string | null;
}) => GameView;

const endIf = BladesAndRose.endIf as unknown as (context: { G: GameState }) => unknown;

/** 依据当前状态给出一个合法动作，用于自动跑完一局 */
function nextMove(G: GameState): Move {
  const actor = currentActor(G);
  if (!actor) throw new Error(`相位 ${G.phase} 没有可行动的玩家`);

  switch (G.phase) {
    case 'magic': {
      const target = G.players.find((p) => !p.crystalPlaced);
      if (!target) throw new Error('没有可接收硬币的玩家');
      return { type: 'passCoin', playerId: actor, to: target.id };
    }
    case 'magicTargets': {
      const pending = G.pendingMagic!;
      const spec = SKILLS[pending.skill].targets;
      const need = spec === 'twoOthersWithCards' ? 2 : 1;
      const candidates = G.players.filter((p) => {
        if (p.id === pending.chooser) return false;
        if (spec === 'oneOtherWithCards' || spec === 'twoOthersWithCards') return p.hand.length > 0;
        return true;
      });
      return { type: 'resolveMagicTargets', playerId: actor, targets: candidates.slice(0, need).map((p) => p.id) };
    }
    case 'play': {
      const player = playerById(G, actor);
      // 10 号换牌挂起：被指定者必须出一张牌完成对调（引擎不接受跳过）
      if (G.pendingRedraw === actor || (G.modifiers.mustPlay.includes(actor) && player.hand.length > 0)) {
        return { type: 'playCard', playerId: actor, cardId: player.hand[0]!.id };
      }
      return { type: 'passTurn', playerId: actor };
    }
    case 'redraw': {
      const candidate = G.players.find(
        (p) => p.id !== actor && G.played[p.id] && p.hand.length > 0,
      );
      return candidate
        ? { type: 'resolveRedraw', playerId: actor, targetId: candidate.id }
        : { type: 'resolveRedraw', playerId: actor };
    }
    default:
      throw new Error(`无法自动推进的相位：${G.phase}`);
  }
}

/** 全程在 immer draft 上推进，等价于 boardgame.io 的 move 执行环境 */
function driveToEnd(seed: number): GameState {
  let G = createGame(NAMES, { seed });
  let steps = 0;
  while (G.phase !== 'finished') {
    const move = nextMove(G);
    G = produce(G, (draft) => {
      applyMoveInPlace(draft as unknown as GameState, move);
    });
    if (++steps > 500) throw new Error(`种子 ${seed} 未能收敛`);
  }
  return G;
}

describe('boardgame.io 适配层', () => {
  it('setup 让引擎玩家 id 与 boardgame.io 的 playerID 完全一致', () => {
    const G = setup({ ctx: { numPlayers: 5 } });
    expect(G.players.map((p) => p.id)).toEqual(['0', '1', '2', '3', '4']);
    expect(G.order).toEqual(['0', '1', '2', '3', '4']);
    expect(G.phase).toBe('magic');
    expect(G.players.every((p) => p.hand.length === 3)).toBe(true);
  });

  it('支持 5-10 人', () => {
    for (let n = 5; n <= 10; n++) {
      const G = setup({ ctx: { numPlayers: n } });
      expect(G.players).toHaveLength(n);
      expect(G.players.map((p) => p.id)).toEqual(
        Array.from({ length: n }, (_, i) => String(i)),
      );
    }
  });

  it('moves 能在 immer draft 上就地生效（boardgame.io 的运行环境）', () => {
    const G0 = setup({ ctx: { numPlayers: 5 } });
    const target = G0.players.find((p) => !p.crystalPlaced)!;

    const G1 = produce(G0, (draft) => {
      moves.passCoin(
        { G: draft as unknown as GameState, ctx: {}, playerID: G0.coinHolder },
        target.id as never,
      );
    });

    expect(G0.crystalsPlaced).toBe(0); // 原状态不被修改
    expect(G1.crystalsPlaced).toBe(1);
    expect(G1.phase).not.toBe('magic');
  });

  it('非法动作返回 INVALID_MOVE 而不是抛错', () => {
    const G = setup({ ctx: { numPlayers: 5 } });
    const notHolder = G.players.find((p) => p.id !== G.coinHolder)!.id;
    const result = moves.passCoin(
      { G, ctx: {}, playerID: notHolder },
      G.players[0]!.id as never,
    );
    expect(result).toBe(INVALID_MOVE);
    expect(G.crystalsPlaced).toBe(0); // 状态未被破坏
  });

  it('endIf 在终局返回 winner', () => {
    const finished = driveToEnd(3);
    expect(finished.winner).toBeTruthy();
    expect(endIf({ G: finished })).toEqual({ winner: finished.winner, reason: finished.winReason });
  });

  it('随机牌局能跑完 25 局，且 playerView 不泄露他人手牌', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const G = driveToEnd(seed);
      expect(G.winner, `种子 ${seed}`).toBeTruthy();

      for (const viewer of G.players) {
        const view = viewOf({ G, ctx: {}, playerID: viewer.id });

        // 他人条目只剩公开字段
        for (const entry of view.players) {
          if (entry.id === viewer.id) continue;
          expect(entry.role).toBeUndefined();
          expect(entry.faction).toBeUndefined();
          expect(entry.hand).toBeUndefined();
          expect(entry.crystal).toBeUndefined();
        }

        // 他人当前手牌的任何一张都不能出现在「公开信息」里。
        // knowledge 需要排除：那是玩家自己通过窥牌/侦查合法获得的情报。
        const hidden = G.players
          .filter((p) => p.id !== viewer.id)
          .flatMap((p) => p.hand.map((c) => c.id));
        const { knowledge: _knowledge, ...publicPart } = view;
        const serialized = JSON.stringify(publicPart);
        for (const cardId of hidden) {
          expect(serialized, `种子 ${seed} 泄露了 ${cardId}`).not.toContain(cardId);
        }
      }
    }
  });

  it('匿名公开时不会下发「谁出了什么」', () => {
    const G = driveToEnd(7);
    // 找出最近一次非顺序公开的结果
    const anonymous = viewOf({ G, ctx: {}, playerID: '0' });
    if (anonymous.lastReveal && !anonymous.lastReveal.attributed) {
      expect(Object.keys(anonymous.lastReveal.byPlayer)).toHaveLength(0);
      expect(anonymous.lastReveal.cards.length).toBeGreaterThan(0);
    }
  });

  it('未取座的观众只能看到公开信息', () => {
    const G = setup({ ctx: { numPlayers: 5 } });
    const spectator = viewOf({ G, ctx: {}, playerID: null });
    expect(spectator.players.every((p) => p.role === undefined && p.hand === undefined)).toBe(true);
    expect(spectator.knowledge).toHaveLength(0);
  });
});

describe('game 名称与配比互转（回主页自动拉回用）', () => {
  it('官方配比的名字反解为 null', () => {
    expect(distributionOfGameName(gameNameOf(null))).toBeNull();
  });

  it('自定义配比的名字能与 gameNameOf 往返一致', () => {
    const distribution: Distribution = {
      whiteRose: 1,
      bishop: 2,
      believer: 1,
      doubleBlade: 0,
      greatBlade: 0,
      darkBlade: 1,
    };
    const name = gameNameOf(distribution);
    expect(name).toContain('blades-and-rose-');
    expect(distributionOfGameName(name)).toEqual(distribution);
  });

  it('无法识别的名字返回 undefined（调用方据此不自动进入）', () => {
    for (const name of ['', 'other-game', 'blades-and-rose-1_0_2', 'blades-and-rose-a_b_c_d_e_f', 'blades-and-rose-1_0_2_0_1_*']) {
      expect(distributionOfGameName(name)).toBeUndefined();
    }
  });
});
