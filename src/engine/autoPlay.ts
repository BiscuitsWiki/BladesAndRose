import { currentActor } from './game';
import { canTarget, targetSpecOf } from './magic';
import { playerById } from './setup';
import type { GameState, Move, PlayerId } from './types';

/** 决策用到的随机源；可注入以便单测 */
export type RandomSource = () => number;

/**
 * AI 托管：断线玩家由服务器临时接管的动作选择（只读状态，不修改）。
 *
 * 约定行为：
 *   - 阶段一（传币）：随机交给一名水晶尚未放上版图的玩家（可以交给自己）；
 *   - 阶段一（选目标）：按技能的目标约束随机选取合法目标；
 *   - 阶段二（出牌）：一律跳过；被规则强制出牌（含 10 号换牌挂起）时不能跳过，改打手中第一张牌；
 *   - 阶段三（换牌，10 号）：放弃使用换牌。
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
      const spec = targetSpecOf(pending.skill);
      const need = spec === 'twoOthersWithCards' ? 2 : 1;
      // 随机顺序逐个尝试：不合法的候选（不能选自己 / 无手牌 / 已选过）自动跳过
      const candidates = state.players.map((p) => p.id);
      const chosen: PlayerId[] = [];
      while (chosen.length < need && candidates.length > 0) {
        const [candidate] = candidates.splice(Math.floor(random() * candidates.length), 1);
        if (canTarget(state, playerId, candidate!, spec, chosen)) chosen.push(candidate!);
      }
      if (chosen.length < need) return null;
      return { type: 'resolveMagicTargets', playerId, targets: chosen };
    }

    case 'play': {
      if (currentActor(state) !== playerId) return null;
      const forced = state.pendingRedraw === playerId || state.modifiers.mustPlay.includes(playerId);
      if (!forced) return { type: 'passTurn', playerId };
      const card = playerById(state, playerId).hand[0];
      if (!card) return null;
      return { type: 'playCard', playerId, cardId: card.id };
    }

    case 'redraw': {
      if (state.modifiers.redrawOption !== playerId) return null;
      return { type: 'resolveRedraw', playerId };
    }

    default:
      return null;
  }
}