import { skillDef, skillOfCrystal } from './config';
import { applySkill, basePlayOrder, hasCards, resolveTargets, targetSpecOf } from './magic';
import { pickRandom } from './rng';
import { finishRound, resolveReveal } from './round';
import { playerById } from './setup';
import type { GameState, Move, PlayerId } from './types';

/** 出牌阶段当前该行动的玩家 */
export function currentActor(state: GameState): PlayerId | null {
  if (state.phase === 'magic') return state.coinHolder;
  if (state.phase === 'magicTargets') return state.pendingMagic?.chooser ?? null;
  if (state.phase === 'play') return state.playOrder[state.turnIndex] ?? null;
  if (state.phase === 'prePick') return state.modifiers.pendingPick?.chooser ?? null;
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
    case 'playRandom':
      return doPlayRandom(state, move.playerId);
    case 'passTurn':
      return doPassTurn(state, move.playerId);
    case 'pickPreShuffleTarget':
      return doPickPreShuffleTarget(state, move.playerId, move.targetId);
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
  // 决策点 1：出牌阶段的基准参与者集合 —— 从受币者起顺时针全体
  state.playOrder = basePlayOrder(state, to);
  state.turnIndex = 0;

  const skill = skillOfCrystal(target.crystal, state.skills);
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
  refreshParticipants(state);
  autoAdvance(state);
}

/**
 * 决策点 1：按「本轮效果」收窄出牌阶段的参与者集合。
 * trio 集合（扩充 5 号）生效时，集合外玩家不进 playOrder —— 自动跳过、不询问。
 */
function refreshParticipants(state: GameState): void {
  if (state.modifiers.trio) {
    const inSet = new Set(state.modifiers.trio);
    state.playOrder = state.playOrder.filter((id) => inSet.has(id));
  }
}

function doResolveMagicTargets(state: GameState, playerId: PlayerId, targets: PlayerId[]): void {
  if (state.phase !== 'magicTargets' || !state.pendingMagic) throw new Error('当前没有待指定的魔法效果');
  const pending = state.pendingMagic;
  if (playerId !== pending.chooser) throw new Error('只有魔法书持有者可以指定目标');

  const resolved = resolveTargets(state, pending.skill, playerId);
  if (targets.length !== resolved.need) throw new Error(`该技能需要指定 ${resolved.need} 名玩家`);

  const chosen: PlayerId[] = [];
  targets.forEach((t) => {
    if (!resolved.pool.includes(t) || chosen.includes(t)) {
      throw new Error(`目标不合法：${t}`);
    }
    chosen.push(t);
  });

  applySkill(state, pending.skill, pending.chooser, targets);
  state.pendingMagic = null;
  state.phase = 'play';
  refreshParticipants(state);
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
  const blocked = playBlockedReason(state, playerId, 'explicit');
  if (blocked) throw new Error(blocked);

  const player = playerById(state, playerId);
  const index = player.hand.findIndex((c) => c.id === cardId);
  if (index < 0) throw new Error('手牌中没有这张牌');
  const card = player.hand[index]!;
  if (state.modifiers.noGhost && card.kind === 'ghost') throw new Error('本轮不能打出幽魂牌');

  player.hand.splice(index, 1);
  if (state.pendingRedraw === playerId) {
    // 10 号换牌：这张牌成为本轮打出的牌，原来的牌收回手中
    commitRedrawSwap(state, playerId, card);
  } else {
    commitPlay(state, playerId, card);
  }
  autoAdvance(state);
}

/**
 * 3 号扩充：本轮随机出牌——玩家自愿出牌，但牌由引擎从其手牌随机抽。
 * 不接受 cardId（客户端只能提交 playRandom）。
 */
function doPlayRandom(state: GameState, playerId: PlayerId): void {
  if (state.phase !== 'play') throw new Error('当前不是出牌阶段');
  if (state.playOrder[state.turnIndex] !== playerId) throw new Error('还没有轮到你');
  if (!state.modifiers.randomPlay) throw new Error('本轮不是随机出牌回合');
  const blocked = playBlockedReason(state, playerId, 'random');
  if (blocked) throw new Error(blocked);

  const player = playerById(state, playerId);
  if (player.hand.length === 0) throw new Error('没有手牌可以出');
  const drawn = pickRandom(state, player.hand);
  const index = player.hand.findIndex((c) => c.id === drawn.id);
  player.hand.splice(index, 1);
  if (state.pendingRedraw === playerId) {
    commitRedrawSwap(state, playerId, drawn);
  } else {
    state.log.push(`${player.name} 随机出了一张牌`);
    commitPlay(state, playerId, drawn);
  }
  autoAdvance(state);
}

/**
 * 决策点 3a：出牌合法性（返回错误信息；null 表示可以出牌）。
 * mode='explicit'（playCard，玩家指定牌）：随机出牌轮拒绝显式选牌；
 * mode='random'（playRandom，引擎抽牌）：不受随机出牌限制；禁幽魂在取到牌后再判。
 */
function playBlockedReason(
  state: GameState,
  playerId: PlayerId,
  mode: 'explicit' | 'random',
): string | null {
  if (state.modifiers.mustPass.includes(playerId)) return '本回合必须跳过';
  if (mode === 'explicit' && state.modifiers.randomPlay) {
    return '本轮出牌由系统随机抽取，请使用「随机出牌」';
  }
  return null;
}

/** 决策点 3b：跳过合法性（返回错误信息；null 表示可以跳过） */
function passBlockedReason(state: GameState, playerId: PlayerId): string | null {
  if (state.modifiers.mustPlay.includes(playerId) || state.modifiers.mustPlayRandom.includes(playerId)) {
    return '本回合必须出牌';
  }
  // 8 号扩充：司教持牌不得跳过。规则由旗标表达，这里按角色实况判定，不向任何公开信息点名
  if (state.modifiers.bishopMustPlay && playerById(state, playerId).role === 'bishop' && hasCards(state, playerId)) {
    return '本回合必须出牌';
  }
  return null;
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
  const blocked = passBlockedReason(state, playerId);
  if (blocked) throw new Error(blocked);
  commitPass(state, playerId);
  autoAdvance(state);
}

function commitPlay(state: GameState, playerId: PlayerId, card: import('./types').Card): void {
  if (state.played[playerId]) {
    // 多圈出牌（4 号扩充）：第一张进 played，之后追加进 extraPlays
    state.extraPlays[playerId]!.push(card);
  } else {
    state.played[playerId] = card;
  }
  // 多圈下先跳过、后出牌时，「已跳过」不再成立
  state.passed[playerId] = false;
  if (!state.playSequence.includes(playerId)) state.playSequence.push(playerId);
  applyPair(state, playerId, 'play');
  state.turnIndex += 1;
}

function commitPass(state: GameState, playerId: PlayerId): void {
  // played 保持现状：多圈下先出牌、后跳过时，此前打出的牌仍然有效
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

// ---------------------------------------------------------------- 阶段四：公开前补出

/**
 * 决策点 6 的落子（扩充 6 号）：chooser 指定一名未出牌的玩家，
 * 引擎随机抽其 1 张匿名混入本轮牌堆（played 记录为已出牌，混洗公开不点名）。
 */
function doPickPreShuffleTarget(state: GameState, playerId: PlayerId, targetId: PlayerId): void {
  if (state.phase !== 'prePick' || !state.modifiers.pendingPick) {
    throw new Error('当前不是公开前的补出决策');
  }
  const pick = state.modifiers.pendingPick;
  if (playerId !== pick.chooser) throw new Error('只有魔法书持有者可以指定补出者');
  if (!pick.pool.includes(targetId)) throw new Error(`目标不合法：${targetId}`);

  const target = playerById(state, targetId);
  const drawn = pickRandom(state, target.hand);
  const index = target.hand.findIndex((c) => c.id === drawn.id);
  target.hand.splice(index, 1);
  state.modifiers.pendingPick = null;
  state.phase = 'play';
  commitPlay(state, targetId, drawn);
  state.log.push(`${playerById(state, playerId).name} 指定 ${target.name} 在公开前补出一张牌`);
  autoAdvance(state);
}

// ---------------------------------------------------------------- 自动推进

/** 本轮已落牌总数（含 4 号扩充第二圈的追加牌） */
function playedCardCount(state: GameState): number {
  let total = 0;
  state.players.forEach((p) => {
    if (state.played[p.id]) total += 1;
    total += state.extraPlays[p.id]?.length ?? 0;
  });
  return total;
}

/** 决策点 4：达阈值立即收束（扩充 10 号） */
function reachedRevealThreshold(state: GameState): boolean {
  return state.modifiers.revealAtCount !== null && playedCardCount(state) >= state.modifiers.revealAtCount;
}

/**
 * 决策点 5：出牌阶段是否收束。
 *  - 达牌数阈值（扩充 10 号）立即收束；
 *  - 否则：计划顺序全部行动完，且圈数走完（扩充 4 号 laps=2 时走两圈）。
 */
function isStageComplete(state: GameState): boolean {
  if (reachedRevealThreshold(state)) return true;
  return state.turnIndex >= state.playOrder.length && state.lap >= state.modifiers.laps;
}

/**
 * 决策点 6：公开前插入决策（扩充 6 号「洗牌前补出」）。
 * 进入决策时点才展开目标池（池 = 当下的未出牌且有手牌者）；池空则无事发生。
 * 返回 true 表示需要等待持有者选择（调用方把 phase 置为 prePick）。
 */
function beginPreShufflePick(state: GameState): boolean {
  const pick = state.modifiers.pendingPick;
  if (!pick) return false;
  const pool = state.players
    .filter((p) => !state.played[p.id] && p.hand.length > 0)
    .map((p) => p.id);
  if (pool.length === 0) {
    state.log.push(`已无未出牌且有手牌的玩家，【${skillDef('preShufflePick').name}】跳过`);
    state.modifiers.pendingPick = null;
    return false;
  }
  pick.pool = pool;
  return true;
}

/**
 * 决策点 2：轮到某玩家时，引擎无需玩家决策就能完成的自动动作。
 *  - 无手牌：只能跳过；
 *  - 被 3/4 号效果指定随机出牌：由引擎随机代打；
 *  - 被指定必须跳过：直接跳过。
 * 返回 null 表示需要等待该玩家自己操作。
 */
function autoActionFor(state: GameState, playerId: PlayerId): 'pass' | 'randomPlay' | null {
  const player = playerById(state, playerId);
  if (player.hand.length === 0) return 'pass';
  if (state.modifiers.mustPlayRandom.includes(playerId)) return 'randomPlay';
  if (state.modifiers.mustPass.includes(playerId)) return 'pass';
  return null;
}

/** 被 3/4 号效果指定的玩家由引擎随机代打（含 10 号换牌挂起时的随机对调） */
function randomPlayFor(state: GameState, playerId: PlayerId): void {
  const player = playerById(state, playerId);
  const card = pickRandom(state, player.hand);
  const index = player.hand.findIndex((c) => c.id === card.id);
  const [drawn] = player.hand.splice(index, 1);
  if (state.pendingRedraw === playerId) {
    // 被随机代打的玩家，其换牌同样由系统随机选牌完成对调
    commitRedrawSwap(state, playerId, drawn!);
  } else {
    state.log.push(`${player.name} 被魔法效果强制随机出牌`);
    commitPlay(state, playerId, drawn!);
  }
}

/**
 * 推进所有无需玩家决策的步骤：
 *  - 环节 1（决策点 5）：阶段收束后进入换牌 / 公开前决策 / 公开结算；
 *  - 环节 2（决策点 2）：无手牌、被强制跳过、被强制随机代打的玩家自动完成；
 *  - 其余情况等待玩家操作。
 */
export function autoAdvance(state: GameState): void {
  let guard = 0;
  while (guard++ < 10000) {
    if (state.phase === 'finished') return;

    if (state.phase !== 'play') return;

    if (isStageComplete(state)) {
      // 10 号（初版）换牌挂起：先让持有者决定换牌
      if (state.modifiers.redrawOption !== null) {
        state.phase = 'redraw';
        return;
      }
      // 决策点 6：公开前的补出决策（扩充 6 号）；池空则无事发生，继续公开
      if (beginPreShufflePick(state)) {
        state.phase = 'prePick';
        return;
      }
      resolveReveal(state);
      finishRound(state);
      continue; // 可能已结束，或已开启下一轮（phase = magic）
    }

    // 决策点 5 扩展：计划顺序走完但圈数未走完 → 回到队首继续下一圈（扩充 4 号）
    if (state.turnIndex >= state.playOrder.length) {
      state.lap += 1;
      state.turnIndex = 0;
      state.log.push(`本轮出牌进入第 ${state.lap} 圈`);
      continue;
    }

    const cur = state.playOrder[state.turnIndex]!;
    const action = autoActionFor(state, cur);
    if (action === 'pass') {
      commitPass(state, cur);
      continue;
    }
    if (action === 'randomPlay') {
      randomPlayFor(state, cur);
      continue;
    }
    return; // 等待玩家操作
  }
  throw new Error('自动推进陷入死循环');
}
