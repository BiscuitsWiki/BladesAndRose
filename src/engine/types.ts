/** 《血与刃的白蔷薇》核心类型定义 */

import type { SkillId } from './config';

export type Role =
  | 'whiteRose' // 白蔷薇
  | 'bishop' // 司教
  | 'believer' // 信者
  | 'greatBlade' // 巨刃
  | 'doubleBlade' // 双刃
  | 'darkBlade'; // 暗刃

export type BladeRole = Extract<Role, 'greatBlade' | 'doubleBlade' | 'darkBlade'>;

/** 阵营在开局抽角色牌时锁定，之后交出角色牌也不会改变 */
export type Faction = 'whiteRose' | 'bloodBlade';

export const FACTION_OF: Record<Role, Faction> = {
  whiteRose: 'whiteRose',
  bishop: 'whiteRose',
  believer: 'whiteRose',
  greatBlade: 'bloodBlade',
  doubleBlade: 'bloodBlade',
  darkBlade: 'bloodBlade',
};

export const BLADE_ROLES: BladeRole[] = ['greatBlade', 'doubleBlade', 'darkBlade'];

export const ROLE_LABEL: Record<Role, string> = {
  whiteRose: '白蔷薇',
  bishop: '司教',
  believer: '信者',
  greatBlade: '巨刃',
  doubleBlade: '双刃',
  darkBlade: '暗刃',
};

/** 角色牌是否带花苞图标（司教、信者各 1 朵） */
export function hasBudIcon(card: Card): boolean {
  if (card.kind === 'believer') return true;
  if (card.kind === 'role') return card.role === 'bishop' || card.role === 'believer';
  return false;
}

export function isBladeCard(card: Card): boolean {
  return card.kind === 'role' && BLADE_ROLES.includes(card.role as BladeRole);
}

export function isWhiteRoseCard(card: Card): boolean {
  return card.kind === 'role' && card.role === 'whiteRose';
}

export type Card =
  | { id: string; kind: 'ghost' } // 幽魂
  | { id: string; kind: 'believer' } // 固定信者（同时带花苞图标）
  | { id: string; kind: 'role'; role: Role };

export type PlayerId = string;

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** 顺时针座次，0 起 */
  seat: number;
  /** 开局的角色牌，阵营随之锁定 */
  role: Role;
  faction: Faction;
  hand: Card[];
  /** 1-12，仅本人可见 */
  crystal: number;
  /** 本轮是否已放出水晶 */
  crystalPlaced: boolean;
}

/** 版图上的各个区域 */
export interface Zones {
  /** 白蔷薇区：生存已确定的白蔷薇 */
  whiteRose: Card[];
  /** 献祭区：无血刃一轮中被打出的司教/信者 */
  sacrifice: Card[];
  /** 死亡区：有血刃一轮中被打出的司教/信者 */
  death: Card[];
  /** 血刃区：被打出的血刃阵营牌 */
  blade: Card[];
  /** 幽魂弃牌堆：开局版图旁的那张 + 打出的幽魂回流（7 号效果改为直接新增，不再从此处取牌） */
  ghosts: Card[];
}

export type Knowledge =
  | { kind: 'nightGroup'; players: PlayerId[] }
  // 暗刃侦查：只能知道白蔷薇与司教的玩家名单，无法区分具体身份
  | { kind: 'scoutedRoles'; players: PlayerId[] }
  | { kind: 'peekedCard'; target: PlayerId; card: Card };

export interface MagicState {
  /** 触发的水晶编号，只是技能指针 */
  crystal: number;
  /** 实际执行的技能 */
  skill: SkillId;
  chooser: PlayerId;
  targets: PlayerId[];
}

export interface RoundModifiers {
  /** 2 号：本轮卡牌不洗混，按出牌顺序公开 */
  revealInOrder: boolean;
  /** 必须出牌（可自选卡） */
  mustPlay: PlayerId[];
  /** 必须随机出牌（引擎自动代打） */
  mustPlayRandom: PlayerId[];
  /** 必须跳过 */
  mustPass: PlayerId[];
  /** 5 号：行动绑定，后行动者与先行动者一致 */
  pairs: [PlayerId, PlayerId][];
  /** 6 号：持有者可选择最后行动 */
  goLastOption: PlayerId | null;
  goLastUsed: boolean;
  /** 10 号：公开前指定一名已出牌玩家，由其自己换牌 */
  redrawOption: PlayerId | null;
}

export function emptyModifiers(): RoundModifiers {
  return {
    revealInOrder: false,
    mustPlay: [],
    mustPlayRandom: [],
    mustPass: [],
    pairs: [],
    goLastOption: null,
    goLastUsed: false,
    redrawOption: null,
  };
}

export interface RevealResult {
  round: number;
  /** 是否公开了出牌者（2 号效果） */
  attributed: boolean;
  /** 本轮的卡牌，attributed 为 true 时顺序即出牌顺序 */
  cards: Card[];
  byPlayer: Record<PlayerId, Card>;
  outcome: 'noCards' | 'sacrifice' | 'slain' | 'whiteRoseKilled';
  /** 本轮持币者（出牌情况名单的起点，公开信息） */
  coinHolder: PlayerId;
  /** 本轮各人是否出牌：从持币者起按座位顺序（只含公开状态，不含牌面） */
  playStatus: { id: PlayerId; played: boolean }[];
}

export type Phase = 'magic' | 'magicTargets' | 'play' | 'redraw' | 'finished';

export interface GameState {
  /** 可序列化的随机种子，保证整局可复现 */
  rngSeed: number;
  playerCount: number;
  players: PlayerState[];
  /** 顺时针座次对应的玩家 id */
  order: PlayerId[];
  coinHolder: PlayerId;
  round: number;
  phase: Phase;
  zones: Zones;
  /** 已被放上版图的水晶，按放置顺序 */
  crystalTrack: { player: PlayerId; value: number }[];
  crystalsPlaced: number;
  modifiers: RoundModifiers;
  pendingMagic: MagicState | null;
  /** 10 号换牌：已被指定、等待自己把选中的手牌与打出的牌对调的玩家 */
  pendingRedraw: PlayerId | null;
  /** 本轮的计划出牌顺序（6 号效果会调整它） */
  playOrder: PlayerId[];
  turnIndex: number;
  /** 玩家实际行动的先后次序，用于 2 号效果的顺序公开 */
  playSequence: PlayerId[];
  played: Record<PlayerId, Card | null>;
  /** 本轮是否已跳过（公开信息，用于区分「跳过」与「尚未行动」；被换牌作废不算跳过） */
  passed: Record<PlayerId, boolean>;
  lastReveal: RevealResult | null;
  knowledge: Record<PlayerId, Knowledge[]>;
  winner: Faction | null;
  winReason: string | null;
  log: string[];
}

export type Move =
  | { type: 'passCoin'; playerId: PlayerId; to: PlayerId }
  | { type: 'resolveMagicTargets'; playerId: PlayerId; targets: PlayerId[] }
  | { type: 'chooseGoLast'; playerId: PlayerId }
  | { type: 'playCard'; playerId: PlayerId; cardId: string }
  | { type: 'passTurn'; playerId: PlayerId }
  | { type: 'resolveRedraw'; playerId: PlayerId; targetId?: PlayerId };
