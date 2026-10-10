import {
  CRYSTAL_NUMBERS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NIGHT_ROLES,
  ROLE_ORDER,
  resolveDistribution,
  validateDistribution,
  type Distribution,
} from './config';
import { shuffleInPlace, nextInt } from './rng';
import {
  FACTION_OF,
  type Card,
  type GameState,
  type PlayerId,
  type PlayerState,
  type Role,
} from './types';
import { emptyModifiers } from './types';

export interface SetupOptions {
  seed?: number;
  /** 自定义玩家 id，用于与宿主框架（如 boardgame.io 的 playerID）对齐；默认 p0、p1… */
  playerIds?: string[];
  /** 自定义角色配比；未指定的角色沿用官方值。合计必须等于人数，且白蔷薇与暗刃必须有且只能有 1 名 */
  distribution?: Partial<Distribution> | null;
  /** 测试用：按座位指定角色，未指定的座位从剩余角色牌中随机补足 */
  roles?: Record<number, Role>;
  /** 测试用：按座位指定水晶编号 */
  crystals?: Record<number, number>;
  /** 测试用：指定起始持币座位 */
  coinSeat?: number;
}

let cardSeq = 0;
function cardId(prefix: string): string {
  cardSeq += 1;
  return `${prefix}#${cardSeq}`;
}

/** 生成一张新的幽魂牌（卡牌 id 全局唯一） */
export function makeGhostCard(): Card {
  return { id: cardId('ghost'), kind: 'ghost' };
}

function buildRoleDeck(distribution: Distribution): Role[] {
  const deck: Role[] = [];
  ROLE_ORDER.forEach((role) => {
    for (let i = 0; i < distribution[role]; i++) deck.push(role);
  });
  return deck;
}

/**
 * 建立一局游戏，并自动结算开局前的「夜晚阶段」：
 *  - 白蔷薇 / 司教 / 双刃 / 巨刃 互相睁眼，互相只知道「谁在同一个组里」，不知道对方身份
 *  - 双刃强制用手牌中的幽魂换走版图旁的双刃（无玩家决策，引擎自动执行）
 */
export function createGame(names: string[], opts: SetupOptions = {}): GameState {
  const playerCount = names.length;
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`玩家人数必须在 ${MIN_PLAYERS}-${MAX_PLAYERS} 之间，当前 ${playerCount}`);
  }

  const state: GameState = {
    rngSeed: opts.seed ?? Math.floor(Math.random() * 0x7fffffff),
    playerCount,
    players: [],
    order: [],
    coinHolder: '',
    round: 1,
    phase: 'magic',
    zones: { whiteRose: [], sacrifice: [], death: [], blade: [], ghosts: [] },
    crystalTrack: [],
    crystalsPlaced: 0,
    modifiers: emptyModifiers(),
    pendingMagic: null,
    pendingRedraw: null,
    playOrder: [],
    turnIndex: 0,
    playSequence: [],
    played: {},
    passed: {},
    lastReveal: null,
    knowledge: {},
    winner: null,
    winReason: null,
    log: [],
  };

  // ---- 准备 6：洗混角色牌并各抽一张 ----
  const distribution = resolveDistribution(playerCount, opts.distribution);
  const invalid = validateDistribution(distribution, playerCount);
  if (invalid) throw new Error(invalid);

  const deck = buildRoleDeck(distribution);
  shuffleInPlace(state, deck);
  const forcedRoles = opts.roles ?? {};
  const takenForced = new Set<Role>();
  (Object.values(forcedRoles) as Role[]).forEach((r) => takenForced.add(r));

  const remaining = deck.filter((r) => {
    if (takenForced.has(r)) {
      takenForced.delete(r);
      return false; // 已按座位指定
    }
    return true;
  });

  const roles: Role[] = [];
  for (let seat = 0; seat < playerCount; seat++) {
    const forced = forcedRoles[seat];
    roles.push(forced ?? remaining.shift()!);
  }

  // ---- 准备 4：洗混水晶并按座位发放 ----
  const crystals = shuffleInPlace(state, [...CRYSTAL_NUMBERS]).slice(0, playerCount);
  if (opts.crystals) {
    for (const [seat, value] of Object.entries(opts.crystals)) crystals[Number(seat)] = value;
  }

  const ids = opts.playerIds ?? Array.from({ length: playerCount }, (_, i) => `p${i}`);
  if (ids.length !== playerCount) throw new Error(`playerIds 数量(${ids.length})与人数(${playerCount})不一致`);
  if (new Set(ids).size !== playerCount) throw new Error('playerIds 存在重复');

  // ---- 准备 3：手牌 = 角色牌 + 幽魂 + 信者 ----
  const players: PlayerState[] = names.map((name, seat) => {
    const role = roles[seat]!;
    const hand: Card[] = [
      { id: cardId('role'), kind: 'role', role },
      makeGhostCard(),
      { id: cardId('believer'), kind: 'believer' },
    ];
    return {
      id: ids[seat]!,
      name,
      seat,
      role,
      faction: FACTION_OF[role],
      hand,
      crystal: crystals[seat]!,
      crystalPlaced: false,
    };
  });

  state.players = players;
  state.order = players.map((p) => p.id);
  players.forEach((p) => {
    state.knowledge[p.id] = [];
    state.played[p.id] = null;
    state.passed[p.id] = false;
  });

  // ---- 准备 2：双刃牌放在版图旁 ----
  const boardDoubleBlade: Card = { id: cardId('role'), kind: 'role', role: 'doubleBlade' };

  // ---- 准备 5：起始持币者 ----
  const coinSeat = opts.coinSeat ?? nextInt(state, playerCount);
  state.coinHolder = players[coinSeat]!.id;
  state.log.push(`起始持币者：${players[coinSeat]!.name}`);

  // ---- 夜晚阶段 ----
  applyNight(state, boardDoubleBlade);

  return state;
}

function applyNight(state: GameState, boardDoubleBlade: Card): void {
  const nightGroup = state.players.filter((p) => NIGHT_ROLES.includes(p.role)).map((p) => p.id);

  // 互认：组内每人拿到一份名单（只有人，没有身份）
  nightGroup.forEach((id) => {
    state.knowledge[id]!.push({ kind: 'nightGroup', players: nightGroup });
  });

  // 双刃换牌：强制，无决策，引擎直接结算
  const doubleBlade = state.players.find((p) => p.role === 'doubleBlade');
  if (doubleBlade) {
    const ghostIndex = doubleBlade.hand.findIndex((c) => c.kind === 'ghost');
    if (ghostIndex >= 0) {
      const [ghost] = doubleBlade.hand.splice(ghostIndex, 1);
      doubleBlade.hand.push(boardDoubleBlade);
      state.zones.ghosts.push(ghost!);
      // 不写公开日志：换牌是夜晚的秘密动作，日志一旦点名就等于公开了双刃的身份
    }
  }
}

/** 顺时针从某位玩家开始的完整座次顺序 */
export function orderFrom(state: GameState, startId: PlayerId): PlayerId[] {
  const start = state.order.indexOf(startId);
  if (start < 0) throw new Error(`未知玩家：${startId}`);
  return Array.from({ length: state.playerCount }, (_, i) => state.order[(start + i) % state.playerCount]!);
}

export function playerById(state: GameState, id: PlayerId): PlayerState {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error(`未知玩家：${id}`);
  return p;
}
