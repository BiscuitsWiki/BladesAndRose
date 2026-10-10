import { SKILLS, WIN_THRESHOLDS, type MagicTargetSpec, type SkillId } from './config';
import { currentActor } from './game';
import { countBuds } from './round';
import { BLADE_ROLES, type BladeRole, type Card, type Faction, type GameState, type Knowledge, type Phase, type PlayerId, type RevealResult, type Role } from './types';

/**
 * 显式拷贝，避免使用 structuredClone。
 * playerView 也可能运行在 immer draft（Proxy）之上，structuredClone 无法处理这类对象。
 */
function cloneCard(card: Card): Card {
  return card.kind === 'role'
    ? { id: card.id, kind: 'role', role: card.role }
    : { id: card.id, kind: card.kind };
}

function cloneKnowledge(knowledge: Knowledge): Knowledge {
  switch (knowledge.kind) {
    case 'nightGroup':
      return { kind: 'nightGroup', players: [...knowledge.players] };
    case 'scoutedRoles':
      return { kind: 'scoutedRoles', players: [...knowledge.players] };
    case 'peekedCard':
      return { kind: 'peekedCard', target: knowledge.target, card: cloneCard(knowledge.card) };
  }
}

export interface PlayerViewEntry {
  id: PlayerId;
  name: string;
  seat: number;
  handCount: number;
  crystalPlaced: boolean;
  /** 本轮是否已出牌（公开信息，但不公开出了什么） */
  played: boolean;
  /** 本轮是否已跳过（公开信息，用于区分「跳过」与「尚未行动」） */
  passed: boolean;
  /** 以下字段只有本人可见 */
  role?: Role;
  faction?: Faction;
  hand?: Card[];
  crystal?: number;
}

export interface GameView {
  viewer: PlayerId;
  round: number;
  phase: Phase;
  coinHolder: PlayerId;
  currentActor: PlayerId | null;
  players: PlayerViewEntry[];
  zones: {
    whiteRose: Card[];
    sacrifice: Card[];
    death: Card[];
    blade: Card[];
    ghostCount: number;
  };
  /** 本局投入的白蔷薇 / 血刃牌总数（配比是公开信息），用作版图区域进度的分母 */
  cardTotals: { whiteRose: number; blade: number };
  thresholds: { sacrifice: number; death: number };
  sacrificeBuds: number;
  deathBuds: number;
  crystalTrack: { player: PlayerId; value: number }[];
  crystalsPlaced: number;
  pendingMagic: {
    crystal: number;
    skill: SkillId;
    name: string;
    text: string;
    chooser: PlayerId;
    needTargets: number;
    /** 目标约束，UI 据此过滤可选玩家 */
    targets: MagicTargetSpec;
  } | null;
  /** 10 号换牌挂起：等待该玩家自己完成对调（公开信息） */
  pendingRedraw: PlayerId | null;
  modifiers: {
    revealInOrder: boolean;
    mustPlay: PlayerId[];
    mustPlayRandom: PlayerId[];
    mustPass: PlayerId[];
    pairs: [PlayerId, PlayerId][];
    goLastOption: PlayerId | null;
    goLastUsed: boolean;
    redrawOption: PlayerId | null;
  };
  lastReveal: RevealResult | null;
  knowledge: Knowledge[];
  winner: Faction | null;
  winReason: string | null;
  log: string[];
}

/**
 * 隐藏信息过滤：每位玩家只能看到自己该看到的状态。
 * 其他人的角色、阵营、手牌、水晶编号一律不下发。
 */
export function playerView(state: GameState, viewerId: PlayerId): GameView {
  const thresholds = WIN_THRESHOLDS[state.playerCount]!;
  const pending = state.pendingMagic;

  return {
    viewer: viewerId,
    round: state.round,
    phase: state.phase,
    coinHolder: state.coinHolder,
    currentActor: currentActor(state),
    players: state.players.map((p) =>
      p.id === viewerId
        ? {
            id: p.id,
            name: p.name,
            seat: p.seat,
            handCount: p.hand.length,
            crystalPlaced: p.crystalPlaced,
            played: Boolean(state.played[p.id]),
            passed: Boolean(state.passed[p.id]),
            role: p.role,
            faction: p.faction,
            hand: p.hand.map(cloneCard),
            crystal: p.crystal,
          }
        : {
            id: p.id,
            name: p.name,
            seat: p.seat,
            handCount: p.hand.length,
            crystalPlaced: p.crystalPlaced,
            played: Boolean(state.played[p.id]),
            passed: Boolean(state.passed[p.id]),
          },
    ),
    zones: {
      whiteRose: state.zones.whiteRose.map(cloneCard),
      sacrifice: state.zones.sacrifice.map(cloneCard),
      death: state.zones.death.map(cloneCard),
      blade: state.zones.blade.map(cloneCard),
      ghostCount: state.zones.ghosts.length,
    },
    // 血刃牌总数是静态口径：血刃角色各持 1 张，另有版图旁那张双刃牌在夜晚换入双刃手中
    // （与牌的实际流动无关，分母在整局内不会中途变化）。
    cardTotals: {
      whiteRose: state.players.filter((p) => p.role === 'whiteRose').length,
      blade:
        state.players.filter((p) => BLADE_ROLES.includes(p.role as BladeRole)).length +
        (state.players.some((p) => p.role === 'doubleBlade') ? 1 : 0),
    },
    thresholds,
    sacrificeBuds: countBuds(state.zones.sacrifice),
    deathBuds: countBuds(state.zones.death),
    crystalTrack: state.crystalTrack.map((t) => ({ ...t })),
    crystalsPlaced: state.crystalsPlaced,
    pendingMagic: pending
      ? {
          crystal: pending.crystal,
          skill: pending.skill,
          name: SKILLS[pending.skill].name,
          text: SKILLS[pending.skill].text,
          chooser: pending.chooser,
          needTargets: SKILLS[pending.skill].targets === 'twoOthersWithCards' ? 2 : 1,
          targets: SKILLS[pending.skill].targets,
        }
      : null,
    pendingRedraw: state.pendingRedraw,
    modifiers: {
      revealInOrder: state.modifiers.revealInOrder,
      mustPlay: [...state.modifiers.mustPlay],
      mustPlayRandom: [...state.modifiers.mustPlayRandom],
      mustPass: [...state.modifiers.mustPass],
      pairs: state.modifiers.pairs.map((p) => [...p] as [PlayerId, PlayerId]),
      goLastOption: state.modifiers.goLastOption,
      goLastUsed: state.modifiers.goLastUsed,
      redrawOption: state.modifiers.redrawOption,
    },
    lastReveal: state.lastReveal
      ? {
          round: state.lastReveal.round,
          attributed: state.lastReveal.attributed,
          outcome: state.lastReveal.outcome,
          cards: state.lastReveal.cards.map(cloneCard),
          // 只有顺序公开（2 号效果）时，出牌者与牌面的对应关系才是公开信息；
          // 匿名公开时绝不能下发 byPlayer，否则等于把「谁出了什么」告诉所有人。
          byPlayer: state.lastReveal.attributed
            ? Object.fromEntries(
                Object.entries(state.lastReveal.byPlayer).map(([id, card]) => [id, cloneCard(card)]),
              )
            : {},
          // 持币者与「谁出牌 / 谁跳过」本就是公开信息，两种公开方式都下发（用于「上一轮公开」区域）
          coinHolder: state.lastReveal.coinHolder,
          playStatus: state.lastReveal.playStatus.map((s) => ({ ...s })),
        }
      : null,
    knowledge: (state.knowledge[viewerId] ?? []).map(cloneKnowledge),
    winner: state.winner,
    winReason: state.winReason,
    log: [...state.log],
  };
}
