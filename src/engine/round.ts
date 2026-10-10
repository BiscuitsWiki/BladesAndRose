import { WIN_THRESHOLDS } from './config';
import { shuffleInPlace } from './rng';
import { orderFrom } from './setup';
import { isBladeCard, isWhiteRoseCard, hasBudIcon, emptyModifiers } from './types';
import type { Card, GameState, RevealResult } from './types';

export function countBuds(cards: Card[]): number {
  return cards.filter(hasBudIcon).length;
}

/** 阶段三：收集本轮所有卡牌，按规则摆放并结算区域 */
export function resolveReveal(state: GameState): void {
  const acted = [...new Set(state.playSequence)];
  const orderedIds = [
    ...acted,
    ...state.players.map((p) => p.id).filter((id) => !acted.includes(id)),
  ].filter((id) => state.played[id]);

  const entries = orderedIds.map((id) => ({ id, card: state.played[id]! }));

  const byPlayer: Record<string, Card> = {};
  entries.forEach((e) => {
    byPlayer[e.id] = e.card;
  });

  if (entries.length === 0) {
    // 常见问题 Q1：无人出牌则跳过阶段三，直接进入下一轮
    state.lastReveal = {
      round: state.round,
      attributed: state.modifiers.revealInOrder,
      cards: [],
      byPlayer,
      outcome: 'noCards',
      coinHolder: state.coinHolder,
      playStatus: playStatusOf(state),
    };
    state.log.push(`第 ${state.round} 轮无人出牌，跳过结算`);
    state.log.push(playStatusLine(state));
    return;
  }

  const cards = entries.map((e) => e.card);
  const attributed = state.modifiers.revealInOrder;
  const display = attributed ? [...cards] : shuffleInPlace(state, [...cards]);

  const blades = cards.filter(isBladeCard);
  const whiteRose = cards.find(isWhiteRoseCard) ?? null;

  let outcome: RevealResult['outcome'];
  if (blades.length > 0 && whiteRose) {
    // 血刃与白蔷薇同轮出现，白蔷薇被当场杀害
    outcome = 'whiteRoseKilled';
  } else if (blades.length === 0) {
    outcome = 'sacrifice';
  } else {
    outcome = 'slain';
  }

  if (outcome === 'sacrifice') {
    cards.forEach((c) => {
      if (isWhiteRoseCard(c)) state.zones.whiteRose.push(c);
      else if (hasBudIcon(c)) state.zones.sacrifice.push(c);
      else state.zones.ghosts.push(c); // 幽魂回流版图旁
    });
  } else if (outcome === 'slain') {
    cards.forEach((c) => {
      if (isBladeCard(c)) state.zones.blade.push(c);
      else if (hasBudIcon(c)) state.zones.death.push(c);
      else state.zones.ghosts.push(c);
    });
  }

  state.lastReveal = {
    round: state.round,
    attributed,
    cards: display,
    byPlayer,
    outcome,
    coinHolder: state.coinHolder,
    playStatus: playStatusOf(state),
  };
  state.log.push(
    `第 ${state.round} 轮公开 ${cards.length} 张牌：${
      outcome === 'whiteRoseKilled' ? '血刃与白蔷薇同轮出现' : outcome === 'sacrifice' ? '献祭成功' : '献祭失败'
    }`,
  );
  state.log.push(playStatusLine(state));
}

/** 轮末胜负判定；未结束则开启下一轮 */
export function finishRound(state: GameState): void {
  const reveal = state.lastReveal;
  const thresholds = WIN_THRESHOLDS[state.playerCount]!;

  if (reveal?.outcome === 'whiteRoseKilled') {
    endGame(state, 'bloodBlade', '白蔷薇与血刃同轮被公开，当场被杀');
    return;
  }

  const whiteRoseSurvived = state.zones.whiteRose.length > 0;
  const sacrificeBuds = countBuds(state.zones.sacrifice);
  const deathBuds = countBuds(state.zones.death);

  if (whiteRoseSurvived && sacrificeBuds >= thresholds.sacrifice) {
    endGame(state, 'whiteRose', `白蔷薇存活且献祭区花苞达到 ${sacrificeBuds}/${thresholds.sacrifice}`);
    return;
  }

  if (deathBuds >= thresholds.death) {
    endGame(state, 'bloodBlade', `死亡区花苞达到 ${deathBuds}/${thresholds.death}`);
    return;
  }

  if (state.crystalsPlaced >= state.playerCount) {
    // 所有水晶已放完仍未分胜负：白蔷薇未成功被收集，或收集的花苞不足阈值，一律血刃胜
    endGame(state, 'bloodBlade', '水晶耗尽，白蔷薇阵营未达成收集与花苞条件');
    return;
  }

  startNextRound(state);
}

function endGame(state: GameState, winner: GameState['winner'], reason: string): void {
  state.winner = winner;
  state.winReason = reason;
  state.phase = 'finished';
  state.log.push(`游戏结束：${winner === 'whiteRose' ? '白蔷薇阵营' : '血刃阵营'} 胜利（${reason}）`);
}

export function startNextRound(state: GameState): void {
  state.round += 1;
  state.phase = 'magic';
  state.modifiers = emptyModifiers();
  state.pendingMagic = null;
  state.pendingRedraw = null;
  state.playOrder = [];
  state.turnIndex = 0;
  state.playSequence = [];
  state.players.forEach((p) => {
    state.played[p.id] = null;
    state.passed[p.id] = false;
  });
  state.log.push(`—— 第 ${state.round} 轮开始，持币者：${playerName(state, state.coinHolder)} ——`);
}

function playerName(state: GameState, id: string): string {
  return state.players.find((p) => p.id === id)?.name ?? id;
}

/**
 * 本轮各人是否出牌：从持币者起按座位顺序。
 * 只含 played 的二元状态（playerView 本就公开），不含牌面与角色，
 * 因此与是否顺序公开、是否洗混无关，也不会泄露「谁出了什么」。
 * 同一份数据两处呈现：`lastReveal.playStatus`（「上一轮公开」区域）与本文件的日志行。
 */
function playStatusOf(state: GameState): { id: string; played: boolean }[] {
  return orderFrom(state, state.coinHolder).map((id) => ({ id, played: !!state.played[id] }));
}

/** 出牌情况的日志文案（与 `lastReveal.playStatus` 同源数据） */
function playStatusLine(state: GameState): string {
  const list = playStatusOf(state)
    .map((s) => `${playerName(state, s.id)} ${s.played ? '已出牌' : '跳过'}`)
    .join('、');
  return `第 ${state.round} 轮出牌情况（自持币者 ${playerName(state, state.coinHolder)} 起顺时针）：${list}`;
}
