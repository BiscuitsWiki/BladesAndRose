/** 《血与刃的白蔷薇》核心类型定义 */

import type { SkillId, SkillLoadout } from './config';

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
  /** 10 号（初版）：公开前指定一名已出牌玩家，由其自己换牌 */
  redrawOption: PlayerId | null;
  // ---- 2025 扩充包 ----
  /** 扩充 3 号：本轮出牌由系统随机抽（自愿出牌/跳过不变） */
  randomPlay: boolean;
  /** 扩充 4 号：出牌圈数（默认 1） */
  laps: 1 | 2;
  /** 扩充 5 号：收窄后的出牌集合（null = 不限制） */
  trio: PlayerId[] | null;
  /** 扩充 10 号：达到该牌数立即收束出牌阶段（null = 不启用） */
  revealAtCount: number | null;
  /** 扩充 8 号：司教持牌不得跳过（只写规则旗标，不含玩家名单） */
  bishopMustPlay: boolean;
  /** 扩充 9 号：本轮禁出幽魂 */
  noGhost: boolean;
  /** 扩充 6 号：公开前补出的待决策状态（pool 在进入决策时点才展开） */
  pendingPick: { chooser: PlayerId; pool: PlayerId[] } | null;
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
    randomPlay: false,
    laps: 1,
    trio: null,
    revealAtCount: null,
    bishopMustPlay: false,
    noGhost: false,
    pendingPick: null,
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

export type Phase = 'magic' | 'magicTargets' | 'play' | 'prePick' | 'redraw' | 'finished';

export interface GameState {
  /** 可序列化的随机种子，保证整局可复现 */
  rngSeed: number;
  /** 本局技能组（水晶槽 1-12 → 技能 id），随对局固化，是技能的唯一权威 */
  skills: SkillLoadout;
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
  /** 本轮的计划出牌顺序（6 号效果会调整它；trio 集合会把非成员剔除） */
  playOrder: PlayerId[];
  turnIndex: number;
  /** 当前处于第几圈（4 号扩充的两圈出牌；默认 1） */
  lap: number;
  /** 玩家实际行动的先后次序，用于 2 号效果的顺序公开 */
  playSequence: PlayerId[];
  played: Record<PlayerId, Card | null>;
  /** 多圈出牌（4 号扩充）中在 played 之后追加的牌，按打出顺序 */
  extraPlays: Record<PlayerId, Card[]>;
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
  | { type: 'playRandom'; playerId: PlayerId }
  | { type: 'passTurn'; playerId: PlayerId }
  | { type: 'pickPreShuffleTarget'; playerId: PlayerId; targetId: PlayerId }
  | { type: 'resolveRedraw'; playerId: PlayerId; targetId?: PlayerId };
