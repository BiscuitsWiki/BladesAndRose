import { skillDef, skillOfCrystal } from './config';
import { applySkill, basePlayOrder, canTarget, targetSpecOf } from './magic';
import { pickRandom } from './rng';
import { finishRound, resolveReveal } from './round';
import { playerById } from './setup';
import type { GameState, Move, PlayerId } from './types';

/** 出牌阶段当前该行动的玩家 */
export function currentActor(state: GameState): PlayerId | null {
  if (state.phase === 'magic') return state.coinHolder;
  if (state.phase === 'magicTargets') return state.pendingMagic?.chooser ?? null;
  if (state.phase === 'play') return state.playOrder[state.turnIndex] ?? null;
  if (state.phase === 'redraw') return state.modifiers.redrawOption;
  return null;
}

/** 纯函数式入口：返回应用动作后的新状态 */
export function applyMove(state: GameState, move: Move): GameState {
  const next = structuredClone(state) as GameState;
  dispatch(next, move);
  return next;
}

/**
 * 就地修改状态。
 * 供已经提供可变草稿的宿主使用（如 boardgame.io 的 immer draft），
 * 这类对象是 Proxy，不能用 structuredClone 复制。
 */
export function applyMoveInPlace(state: GameState, move: Move): void {
  dispatch(state, move);
}

function dispatch(state: GameState, move: Move): void {
  if (state.phase === 'finished') throw new Error('游戏已经结束');
  switch (move.type) {
    case 'passCoin':
      return doPassCoin(state, move.playerId, move.to);
    case 'resolveMagicTargets':
      return doResolveMagicTargets(state, move.playerId, move.targets);
    case 'chooseGoLast':
      return doChooseGoLast(state, move.playerId);
    case 'playCard':
      return doPlayCard(state, move.playerId, move.cardId);
    case 'passTurn':
      return doPassTurn(state, move.playerId);
    case 'resolveRedraw':
      return doResolveRedraw(state, move.playerId, move.targetId);
    default: {
      const never: never = move;
      throw new Error(`未知动作：${JSON.stringify(never)}`);
    }
  }
}

// ---------------------------------------------------------------- 阶段一：传币

function doPassCoin(state: GameState, playerId: PlayerId, to: PlayerId): void {
  if (state.phase !== 'magic') throw new Error('当前不是传币阶段');
  if (playerId !== state.coinHolder) throw new Error('只有持币者可以交出硬币');
  const holder = playerById(state, playerId);
  const target = playerById(state, to);
  if (target.crystalPlaced) throw new Error(`${target.name} 的水晶已经放上版图`);

  target.crystalPlaced = true;
  state.crystalsPlaced += 1;
  state.crystalTrack.push({ player: to, value: target.crystal });
  state.coinHolder = to;
  state.playOrder = basePlayOrder(state, to);
  state.turnIndex = 0;

  const skill = skillOfCrystal(target.crystal);
  const def = skillDef(skill);
  state.log.push(
    `${holder.name} 把硬币交给 ${target.name}，翻开水晶 ${target.crystal} —— 【${def.name}】`,
  );

  if (targetSpecOf(skill) === 'none') {
    applySkill(state, skill, to, []);
    state.phase = 'play';
  } else {
    state.pendingMagic = { crystal: target.crystal, skill, chooser: to, targets: [] };
    state.phase = 'magicTargets';
  }
  autoAdvance(state);
}

function doResolveMagicTargets(state: GameState, playerId: PlayerId, targets: PlayerId[]): void {
  if (state.phase !== 'magicTargets' || !state.pendingMagic) throw new Error('当前没有待指定的魔法效果');
  const pending = state.pendingMagic;
  if (playerId !== pending.chooser) throw new Error('只有魔法书持有者可以指定目标');

  const spec = targetSpecOf(pending.skill);
  const need = spec === 'twoOthersWithCards' ? 2 : 1;
  if (targets.length !== need) throw new Error(`该技能需要指定 ${need} 名玩家`);

  const chosen: PlayerId[] = [];
  targets.forEach((t) => {
    if (!canTarget(state, playerId, t, spec, chosen)) {
      throw new Error(`目标不合法：${t}`);
    }
    chosen.push(t);
  });

  applySkill(state, pending.skill, pending.chooser, targets);
  state.pendingMagic = null;
  state.phase = 'play';
  autoAdvance(state);
}

// ---------------------------------------------------------------- 阶段二：出牌

function doChooseGoLast(state: GameState, playerId: PlayerId): void {
  if (state.phase !== 'play') throw new Error('当前不是出牌阶段');
  if (state.modifiers.goLastOption !== playerId) throw new Error('你没有殿后的选择权');
  if (state.modifiers.goLastUsed) throw new Error('已经使用过殿后');
  if (state.playOrder[state.turnIndex] !== playerId) throw new Error('只能在自己的回合选择殿后');

  const [cur] = state.playOrder.splice(state.turnIndex, 1);
  state.playOrder.push(cur!);
  state.modifiers.goLastUsed = true;
  state.log.push(`${playerById(state, playerId).name} 选择最后行动`);
  autoAdvance(state);
}

function doPlayCard(state: GameState, playerId: PlayerId, cardId: string): void {
  if (state.phase !== 'play') throw new Error('当前不是出牌阶段');
  if (state.playOrder[state.turnIndex] !== playerId) throw new Error('还没有轮到你');
  if (state.modifiers.mustPass.includes(playerId)) throw new Error('本回合必须跳过');

  const player = playerById(state, playerId);
  const index = player.hand.findIndex((c) => c.id === cardId);
  if (index < 0) throw new Error('手牌中没有这张牌');

  const [card] = player.hand.splice(index, 1);
  if (state.pendingRedraw === playerId) {
    // 10 号换牌：这张牌成为本轮打出的牌，原来的牌收回手中
    commitRedrawSwap(state, playerId, card!);
  } else {
    commitPlay(state, playerId, card!);
  }
  autoAdvance(state);
}

/** 10 号换牌：把选中的手牌与已打出的牌对调，原牌收回手中 */
function commitRedrawSwap(state: GameState, playerId: PlayerId, card: import('./types').Card): void {
  const player = playerById(state, playerId);
  const played = state.played[playerId];
  if (!played) throw new Error('换牌者本轮没有已打出的牌');
  player.hand.push(played);
  state.played[playerId] = card;
  state.pendingRedraw = null;
  state.turnIndex += 1;
  state.log.push(`${player.name} 完成换牌，被替换的牌收回手中`);
}

function doPassTurn(state: GameState, playerId: PlayerId): void {
  if (state.phase !== 'play') throw new Error('当前不是出牌阶段');
  if (state.playOrder[state.turnIndex] !== playerId) throw new Error('还没有轮到你');
  if (state.pendingRedraw === playerId) throw new Error('换牌必须完成，不能跳过');
  if (state.modifiers.mustPlay.includes(playerId) || state.modifiers.mustPlayRandom.includes(playerId)) {
    throw new Error('本回合必须出牌');
  }
  commitPass(state, playerId);
  autoAdvance(state);
}

function commitPlay(state: GameState, playerId: PlayerId, card: import('./types').Card): void {
  state.played[playerId] = card;
  if (!state.playSequence.includes(playerId)) state.playSequence.push(playerId);
  applyPair(state, playerId, 'play');
  state.turnIndex += 1;
}

function commitPass(state: GameState, playerId: PlayerId): void {
  state.played[playerId] = null;
  state.passed[playerId] = true;
  if (!state.playSequence.includes(playerId)) state.playSequence.push(playerId);
  applyPair(state, playerId, 'pass');
  state.turnIndex += 1;
}

/** 5 号效果：先行动者确定后，后行动者被绑定为相同选择 */
function applyPair(state: GameState, playerId: PlayerId, action: 'play' | 'pass'): void {
  const pair = state.modifiers.pairs.find((p) => p[0] === playerId);
  if (!pair) return;
  const partner = pair[1];
  const list = action === 'play' ? state.modifiers.mustPlay : state.modifiers.mustPass;
  if (!list.includes(partner)) list.push(partner);
  state.log.push(
    `${playerById(state, partner).name} 因行动绑定必须${action === 'play' ? '出牌' : '跳过'}`,
  );
}

// ---------------------------------------------------------------- 阶段三：换牌

function doResolveRedraw(state: GameState, playerId: PlayerId, targetId?: PlayerId): void {
  if (state.phase !== 'redraw') throw new Error('当前不是换牌阶段');
  if (state.modifiers.redrawOption !== playerId) throw new Error('你没有换牌的选择权');

  if (!targetId) {
    state.modifiers.redrawOption = null;
    state.phase = 'play';
    state.log.push(`${playerById(state, playerId).name} 放弃使用换牌`);
    autoAdvance(state);
    return;
  }

  if (targetId === playerId) throw new Error('不能指定自己');
  const target = playerById(state, targetId);
  const played = state.played[targetId];
  if (!played) throw new Error(`${target.name} 本轮没有出牌`);
  if (target.hand.length === 0) throw new Error(`${target.name} 没有剩余的牌可以替换`);

  // 挂起换牌：等被指定者自己把选中的手牌与打出的牌对调（原牌收回手中）。
  // 复用出牌阶段的选牌界面（phase 仍为 play），由 pendingRedraw 标识这不是普通出牌。
  state.modifiers.redrawOption = null;
  state.pendingRedraw = targetId;
  state.playOrder = [targetId];
  state.turnIndex = 0;
  state.phase = 'play';
  state.log.push(`${playerById(state, playerId).name} 指定 ${target.name} 自己换牌`);
  autoAdvance(state);
}

// ---------------------------------------------------------------- 自动推进

/**
 * 推进所有无需玩家决策的步骤：
 *  - 无手牌的玩家只能跳过
 *  - 被 3/4 号效果指定的玩家由引擎随机代打
 *  - 出牌阶段结束后进入换牌或公开结算
 */
export function autoAdvance(state: GameState): void {
  let guard = 0;
  while (guard++ < 10000) {
    if (state.phase === 'finished') return;

    if (state.phase !== 'play') return;

    if (state.turnIndex >= state.playOrder.length) {
      if (state.modifiers.redrawOption !== null) {
        state.phase = 'redraw';
        return;
      }
      resolveReveal(state);
      finishRound(state);
      continue; // 可能已结束，或已开启下一轮（phase = magic）
    }

    const cur = state.playOrder[state.turnIndex]!;
    const player = playerById(state, cur);

    if (player.hand.length === 0) {
      commitPass(state, cur);
      continue;
    }
    if (state.modifiers.mustPlayRandom.includes(cur)) {
      const card = pickRandom(state, player.hand);
      const index = player.hand.findIndex((c) => c.id === card.id);
      const [drawn] = player.hand.splice(index, 1);
      if (state.pendingRedraw === cur) {
        // 被 3/4 号效果随机代打的玩家，其换牌同样由系统随机选牌完成对调
        commitRedrawSwap(state, cur, drawn!);
      } else {
        state.log.push(`${player.name} 被魔法效果强制随机出牌`);
        commitPlay(state, cur, drawn!);
      }
      continue;
    }
    if (state.modifiers.mustPass.includes(cur)) {
      commitPass(state, cur);
      continue;
    }
    return; // 等待玩家操作
  }
  throw new Error('自动推进陷入死循环');
}
