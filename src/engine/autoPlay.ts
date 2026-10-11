import { currentActor } from './game';
import { resolveTargets } from './magic';
import { playerById } from './setup';
import type { GameState, Move, PlayerId } from './types';

/** 决策用到的随机源；可注入以便单测 */
export type RandomSource = () => number;

/**
 * AI 托管：断线玩家由服务器临时接管的动作选择（只读状态，不修改）。
 *
 * 约定行为：
 *   - 阶段一（传币）：随机交给一名水晶尚未放上版图的玩家（可以交给自己）；
 *   - 阶段一（选目标）：按技能的目标池与可选数随机选取合法目标（目标池由引擎解析，含扩充技能）；
 *   - 阶段二（出牌）：一律跳过；被规则强制出牌（含 10 号换牌挂起、8 号司教持牌）时改打手中第一张牌；
 *     3 号扩充的随机出牌轮直接提交「随机出牌」，由引擎抽牌；
 *   - 阶段三（换牌，10 号）：放弃使用换牌；
 *   - 阶段四（公开前补出，扩充 6 号）：从待选池中随机指定一人。
 *
 * 返回 null 表示当前还轮不到该座位决策（或该阶段没有需要它决定的事），
 * 调用方（服务器巡检）下一趟再来问即可。
 */
export function autoMoveFor(
  state: GameState,
  playerId: PlayerId,
  random: RandomSource = Math.random,
): Move | null {
  switch (state.phase) {
    case 'magic': {
      if (state.coinHolder !== playerId) return null;
      const candidates = state.players.filter((p) => !p.crystalPlaced);
      if (candidates.length === 0) return null;
      const target = candidates[Math.floor(random() * candidates.length)]!;
      return { type: 'passCoin', playerId, to: target.id };
    }

    case 'magicTargets': {
      const pending = state.pendingMagic;
      if (!pending || pending.chooser !== playerId) return null;
      const { need, pool } = resolveTargets(state, pending.skill, playerId);
      if (need === 0) return { type: 'resolveMagicTargets', playerId, targets: [] };
      // 从目标池中不重复地随机抽取 need 个（池已按规则排除自己 / 无手牌者 / 不可选对象）
      const candidates = [...pool];
      const chosen: PlayerId[] = [];
      while (chosen.length < need && candidates.length > 0) {
        const [candidate] = candidates.splice(Math.floor(random() * candidates.length), 1);
        chosen.push(candidate!);
      }
      if (chosen.length < need) return null;
      return { type: 'resolveMagicTargets', playerId, targets: chosen };
    }

    case 'play': {
      if (currentActor(state) !== playerId) return null;
      // 3 号扩充：随机出牌轮由托管者直接随机出牌（引擎抽牌），不跳过
      if (state.modifiers.randomPlay) return { type: 'playRandom', playerId };
      const player = playerById(state, playerId);
      const forced =
        state.pendingRedraw === playerId ||
        state.modifiers.mustPlay.includes(playerId) ||
        // 8 号扩充：司教持牌必须出牌（判定只在服务器侧，不产生公开信息）
        (state.modifiers.bishopMustPlay && player.role === 'bishop' && player.hand.length > 0);
      if (!forced) return { type: 'passTurn', playerId };
      const card = player.hand[0];
      if (!card) return null;
      return { type: 'playCard', playerId, cardId: card.id };
    }

    case 'prePick': {
      const pick = state.modifiers.pendingPick;
      if (!pick || pick.chooser !== playerId || pick.pool.length === 0) return null;
      const target = pick.pool[Math.floor(random() * pick.pool.length)]!;
      return { type: 'pickPreShuffleTarget', playerId, targetId: target };
    }

    case 'redraw': {
      if (state.modifiers.redrawOption !== playerId) return null;
      return { type: 'resolveRedraw', playerId };
    }

    default:
      return null;
  }
}