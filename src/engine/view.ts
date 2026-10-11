import { SKILLS, WIN_THRESHOLDS, type MagicTargetSpec, type SkillId, type SkillLoadout } from './config';
import { currentActor } from './game';
import { resolveTargets } from './magic';
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
  /** 本局技能组（12 槽）；技能文案一律由它派生，客户端不自行推断 */
  skills: SkillLoadout;
  /** 当前圈次（4 号扩充的两圈出牌；默认 1） */
  lap: number;
  pendingMagic: {
    crystal: number;
    skill: SkillId;
    name: string;
    text: string;
    chooser: PlayerId;
    needTargets: number;
    /** 目标约束，UI 据此过滤可选玩家 */
    targets: MagicTargetSpec;
    /** 动态目标池（本局实况解析，含扩充技能）：UI 只允许从这里选人 */
    pool: PlayerId[];
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
    /** 扩充 3 号：本轮出牌由系统随机抽 */
    randomPlay: boolean;
    /** 扩充 4 号：出牌圈数 */
    laps: 1 | 2;
    /** 扩充 5 号：收窄后的出牌集合 */
    trio: PlayerId[] | null;
    /** 扩充 8 号：司教持牌必须出牌（规则旗标，不含玩家名单） */
    bishopMustPlay: boolean;
    /** 扩充 9 号：禁出幽魂 */
    noGhost: boolean;
    /** 扩充 6 号：公开前补出的待选状态（pool 为空表示尚未进入决策） */
    pendingPick: { chooser: PlayerId; pool: PlayerId[] } | null;
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
  /** 待选技能的目标池与必选数（按本局实况解析，含扩充技能；旧字段 needTargets/targets 语义不变） */
  const pendingTargets = pending ? resolveTargets(state, pending.skill, pending.chooser) : null;

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
    skills: { ...state.skills },
    lap: state.lap,
    pendingMagic: pending
      ? {
          crystal: pending.crystal,
          skill: pending.skill,
          name: SKILLS[pending.skill].name,
          text: SKILLS[pending.skill].text,
          chooser: pending.chooser,
          needTargets: pendingTargets!.need,
          targets: SKILLS[pending.skill].targets,
          pool: [...pendingTargets!.pool],
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
      randomPlay: state.modifiers.randomPlay,
      laps: state.modifiers.laps,
      trio: state.modifiers.trio ? [...state.modifiers.trio] : null,
      bishopMustPlay: state.modifiers.bishopMustPlay,
      noGhost: state.modifiers.noGhost,
      pendingPick: state.modifiers.pendingPick
        ? { chooser: state.modifiers.pendingPick.chooser, pool: [...state.modifiers.pendingPick.pool] }
        : null,
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
