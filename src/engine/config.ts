import type { Role } from './types';

/** 各人数下的角色牌分布（来自官方规则书） */
export const ROLE_DISTRIBUTION: Record<number, Record<Role, number>> = {
  5: { whiteRose: 1, bishop: 1, believer: 1, greatBlade: 0, doubleBlade: 1, darkBlade: 1 },
  6: { whiteRose: 1, bishop: 1, believer: 2, greatBlade: 0, doubleBlade: 1, darkBlade: 1 },
  7: { whiteRose: 1, bishop: 1, believer: 2, greatBlade: 1, doubleBlade: 1, darkBlade: 1 },
  8: { whiteRose: 1, bishop: 1, believer: 3, greatBlade: 1, doubleBlade: 1, darkBlade: 1 },
  9: { whiteRose: 1, bishop: 1, believer: 3, greatBlade: 2, doubleBlade: 1, darkBlade: 1 },
  10: { whiteRose: 1, bishop: 1, believer: 4, greatBlade: 2, doubleBlade: 1, darkBlade: 1 },
};

/** 胜负阈值：sacrifice = 白蔷薇阵营胜利所需的献祭区花苞数；death = 血刃阵营胜利所需的死亡区花苞数 */
export const WIN_THRESHOLDS: Record<number, { sacrifice: number; death: number }> = {
  5: { sacrifice: 3, death: 4 },
  6: { sacrifice: 4, death: 4 },
  7: { sacrifice: 4, death: 6 },
  8: { sacrifice: 5, death: 6 },
  9: { sacrifice: 5, death: 7 },
  10: { sacrifice: 6, death: 7 },
};

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;

/** 夜晚阶段会睁眼的角色（互相看得到同组的人，但看不到身份） */
export const NIGHT_ROLES: Role[] = ['whiteRose', 'bishop', 'doubleBlade', 'greatBlade'];

/** 水晶共 12 枚，编号 1-12 */
export const CRYSTAL_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// ------------------------------------------------------------------ 魔法书

export type MagicTargetSpec =
  | 'none' // 无需选择
  | 'oneAny' // 指定任意一名玩家（含自己）
  | 'oneOther' // 指定一名其他玩家
  | 'oneOtherWithCards' // 指定一名有手牌的其他玩家
  | 'twoOthersWithCards' // 指定两名有手牌的其他玩家
  | 'oneOrTwoOthersWithCards' // 扩充 5 号：从「其他有手牌玩家」中选 min(2, 池) 人
  | 'oneOrTwoOthers'; // 扩充 2 号：从「其他玩家」中选（≥8 人局 2 人，否则 1 人）

/** 技能 ID。与规则书条目编号无关，不同条目可以指向同一个技能。 */
export type SkillId =
  | 'forcePlay' // 强制出牌
  | 'revealInOrder' // 顺序公开
  | 'rightNeighborRandom' // 右邻随机出牌
  | 'leftNeighborRandom' // 左邻随机出牌
  | 'pairAction' // 行动绑定
  | 'goLast' // 殿后
  | 'gainGhost' // 获得幽魂
  | 'bothNeighborsPlay' // 两邻出牌
  | 'darkBladeScout' // 暗刃侦查
  | 'replacePlayedCard' // 换牌
  | 'peekHand' // 窥牌
  // ---- 2025 扩充包新增 ----
  | 'forcePass' // 指定不可出牌
  | 'randomPlay' // 本轮随机出牌（自愿出牌、牌由系统抽）
  | 'twoLapPlay' // 出牌问两圈
  | 'trioPlay' // 集合同出（自己 + 至多两名）
  | 'preShufflePick' // 洗牌前指定未出牌者随机补出
  | 'bishopMustPlay' // 司教有牌必须出牌（身份隐藏）
  | 'noGhost' // 不能出幽魂
  | 'earlyReveal'; // 出到第 3 张就混洗开牌

export interface SkillDef {
  id: SkillId;
  name: string;
  text: string;
  targets: MagicTargetSpec;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  forcePlay: {
    id: 'forcePlay',
    name: '强制出牌',
    text: '指定一名有手牌的玩家，本轮必须出牌',
    targets: 'oneOtherWithCards',
  },
  revealInOrder: {
    id: 'revealInOrder',
    name: '顺序公开',
    text: '本轮卡牌不洗混，按出牌顺序公开',
    targets: 'none',
  },
  rightNeighborRandom: {
    id: 'rightNeighborRandom',
    name: '右邻随机',
    text: '右邻（上家）回合必须随机出牌（系统代打）',
    targets: 'none',
  },
  leftNeighborRandom: {
    id: 'leftNeighborRandom',
    name: '左邻随机',
    text: '左邻（下家）回合必须随机出牌（系统代打）',
    targets: 'none',
  },
  pairAction: {
    id: 'pairAction',
    name: '行动绑定',
    text: '指定两名玩家，后行动者必须与先行动者一致',
    targets: 'twoOthersWithCards',
  },
  goLast: {
    id: 'goLast',
    name: '殿后',
    text: '持有者可在自己回合选择本轮最后行动',
    targets: 'none',
  },
  gainGhost: {
    id: 'gainGhost',
    name: '获得幽魂',
    text: '指定一名玩家（可指定自己）直接获得一枚新的幽魂',
    targets: 'oneAny',
  },
  bothNeighborsPlay: {
    id: 'bothNeighborsPlay',
    name: '两邻出牌',
    text: '左右邻（上家、下家）回合必须出牌',
    targets: 'none',
  },
  darkBladeScout: {
    id: 'darkBladeScout',
    name: '暗刃侦查',
    text: '暗刃查看白蔷薇与司教（只能知道名单，无法区分具体身份）',
    targets: 'none',
  },
  replacePlayedCard: {
    id: 'replacePlayedCard',
    name: '换牌',
    text: '公开前指定一名本轮已出牌且仍有剩余手牌的其他玩家，让该玩家自己换牌——从剩余手牌中选一张与打出的牌对调，原牌收回手中',
    targets: 'none',
  },
  peekHand: {
    id: 'peekHand',
    name: '窥牌',
    text: '随机查看指定玩家的一张手牌',
    targets: 'oneOther',
  },
  // ---- 2025 扩充包 ----
  forcePass: {
    id: 'forcePass',
    name: '禁止出牌',
    text: '指定一至两名玩家，本轮不可出牌（8 人局以上指定 2 名）',
    targets: 'oneOrTwoOthers',
  },
  randomPlay: {
    id: 'randomPlay',
    name: '随机出牌',
    text: '本轮所有玩家出牌时由系统随机抽牌（仍可自愿跳过）',
    targets: 'none',
  },
  twoLapPlay: {
    id: 'twoLapPlay',
    name: '双重出牌',
    text: '本轮出牌进行两圈，每人有两次出牌机会（可跳过）',
    targets: 'none',
  },
  trioPlay: {
    id: 'trioPlay',
    name: '同出',
    text: '指定至多两名有手牌的玩家与你一同出牌（集合内每人各出 1 张）',
    targets: 'oneOrTwoOthersWithCards',
  },
  preShufflePick: {
    id: 'preShufflePick',
    name: '洗牌前补出',
    text: '公开前指定一名未出牌的玩家随机补出 1 张牌（匿名混入）',
    targets: 'none',
  },
  bishopMustPlay: {
    id: 'bishopMustPlay',
    name: '司教无保留',
    text: '本轮司教若持有手牌则必须出牌（身份保持隐藏）',
    targets: 'none',
  },
  noGhost: {
    id: 'noGhost',
    name: '禁幽魂',
    text: '本轮任何玩家都不能打出幽魂牌',
    targets: 'none',
  },
  earlyReveal: {
    id: 'earlyReveal',
    name: '三张即开',
    text: '本轮第 3 张牌落牌后立即混洗公开',
    targets: 'none',
  },
};

/**
 * 技能组（loadout）：水晶槽 1-12 → 技能 id。同一技能可占多个槽位（如初版 1≡12）。
 * 随对局保存在 `GameState.skills`，是本局唯一的技能权威。
 */
export type SkillLoadout = Record<number, SkillId>;

/**
 * 水晶编号 -> 技能（初版映射的字面量）。
 *
 * 编号只是技能指针，与发动顺序无关：每名玩家持有一枚水晶，
 * 每枚水晶只发动一次，因此 N 人局恰好 N 轮，每轮由受币者发动自己的水晶。
 * 1 号与 12 号指向同一技能，所以技能数与编号数并不一一对应。
 */
export const CRYSTAL_TO_SKILL: Record<number, SkillId> = {
  1: 'forcePlay',
  2: 'revealInOrder',
  3: 'rightNeighborRandom',
  4: 'leftNeighborRandom',
  5: 'pairAction',
  6: 'goLast',
  7: 'gainGhost',
  8: 'bothNeighborsPlay',
  9: 'darkBladeScout',
  10: 'replacePlayedCard',
  11: 'peekHand',
  12: 'forcePlay',
};

/** 初版技能组（与 CRYSTAL_TO_SKILL 一致） */
export const LOADOUT_BASE: SkillLoadout = CRYSTAL_TO_SKILL;

/** 2025 扩充包技能组（10 个技能、12 槽；11≡2、12≡1 为刻意复用） */
export const LOADOUT_2025: SkillLoadout = {
  1: 'forcePlay',
  2: 'forcePass',
  3: 'randomPlay',
  4: 'twoLapPlay',
  5: 'trioPlay',
  6: 'preShufflePick',
  7: 'goLast',
  8: 'bishopMustPlay',
  9: 'noGhost',
  10: 'earlyReveal',
  11: 'forcePass',
  12: 'forcePlay',
};

/** 具名预设技能组（房间面板展示、热座选择用） */
export interface LoadoutPreset {
  id: string;
  name: string;
  loadout: SkillLoadout;
}

export const LOADOUT_PRESETS: LoadoutPreset[] = [
  { id: 'base', name: '初版', loadout: LOADOUT_BASE },
  { id: '2025', name: '2025 扩充包', loadout: LOADOUT_2025 },
];

/** 技能组的字面量签名（按槽序拼接），用于比较两套技能组是否一致 */
export function loadoutSignature(loadout: SkillLoadout): string {
  return CRYSTAL_NUMBERS.map((slot) => loadout[slot] ?? '?').join(',');
}

/** 两套技能组是否一致 */
export function sameLoadout(a: SkillLoadout | null | undefined, b: SkillLoadout | null | undefined): boolean {
  if (!a || !b) return a === b;
  return loadoutSignature(a) === loadoutSignature(b);
}

/** 命中预设时返回预设 id（如 base / 2025），否则返回 null */
export function loadoutPresetId(loadout: SkillLoadout): string | null {
  const hit = LOADOUT_PRESETS.find((preset) => sameLoadout(preset.loadout, loadout));
  return hit?.id ?? null;
}

/**
 * 校验技能组：必须恰好是 1-12 这 12 个槽，每槽都是已知技能 id。
 * 返回错误信息；null 表示合法。供服务器入参校验与引擎兜底共用。
 */
export function validateLoadout(loadout: unknown): string | null {
  if (typeof loadout !== 'object' || loadout === null || Array.isArray(loadout)) {
    return '技能组必须是一个对象';
  }
  const record = loadout as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const slot = Number(key);
    // 只认「1」-「12」这种规范数字键：__proto__、01、13 之类一律拒绝
    if (!/^\d+$/.test(key) || String(slot) !== key || !CRYSTAL_NUMBERS.includes(slot)) {
      return `技能组包含非法槽位：${key}`;
    }
  }
  for (const slot of CRYSTAL_NUMBERS) {
    const value = record[String(slot)];
    // 只认 SKILLS 自有键，避免 constructor 之类原型链键蒙混过关
    if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(SKILLS, value)) {
      return `水晶槽 ${slot} 未指定合法技能`;
    }
  }
  return null;
}

/**
 * 解析技能组（引擎侧兜底）：缺失或非法时回退初版。
 * 返回全新对象，只含 1-12 这 12 个槽，不与被引用的入参对象共享。
 */
export function resolveLoadout(loadout?: unknown): SkillLoadout {
  if (loadout === undefined || loadout === null || validateLoadout(loadout) !== null) {
    return { ...LOADOUT_BASE };
  }
  const record = loadout as SkillLoadout;
  const out: SkillLoadout = {};
  CRYSTAL_NUMBERS.forEach((slot) => {
    out[slot] = record[slot]!;
  });
  return out;
}

/**
 * 按本局技能组查询水晶对应技能。
 * loadout 缺省为初版（兼容旧调用），引擎 / 联机路径一律显式传 `state.skills`。
 */
export function skillOfCrystal(crystal: number, loadout: SkillLoadout = LOADOUT_BASE): SkillId {
  const skill = loadout[crystal];
  if (!skill) throw new Error(`水晶 ${crystal} 没有对应的技能`);
  return skill;
}

export function skillDef(skill: SkillId): SkillDef {
  return SKILLS[skill];
}

// ------------------------------------------------------------ 自定义配比

/** 配比编辑与展示使用的固定角色顺序 */
export const ROLE_ORDER: Role[] = [
  'whiteRose',
  'bishop',
  'believer',
  'doubleBlade',
  'greatBlade',
  'darkBlade',
];

export type Distribution = Record<Role, number>;

export function officialDistribution(playerCount: number): Distribution {
  const dist = ROLE_DISTRIBUTION[playerCount];
  if (!dist) throw new Error(`不支持的人数：${playerCount}`);
  return { ...dist };
}

/** 合并自定义配比；未指定的角色沿用官方值 */
export function resolveDistribution(
  playerCount: number,
  override?: Partial<Distribution> | null,
): Distribution {
  return { ...officialDistribution(playerCount), ...(override ?? {}) };
}

/** 返回错误信息；null 表示配比合法 */
export function validateDistribution(
  distribution: Distribution,
  playerCount: number,
): string | null {
  for (const role of ROLE_ORDER) {
    const value = distribution[role];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(`角色 ${role} 的数量必须是非负整数`);
    }
  }
  const total = ROLE_ORDER.reduce((sum, role) => sum + distribution[role], 0);
  if (total !== playerCount) {
    return `配比合计 ${total}，与 ${playerCount} 人不一致`;
  }
  // 白蔷薇与暗刃必须有且只能有 1 名，不随自定义配比变化
  if (distribution.whiteRose !== 1) {
    return `白蔷薇必须有且只能有 1 名（当前 ${distribution.whiteRose} 名）`;
  }
  if (distribution.darkBlade !== 1) {
    return `暗刃必须有且只能有 1 名（当前 ${distribution.darkBlade} 名）`;
  }
  return null;
}

/** 稳定的字面量签名，用作 boardgame.io 的 game 缓存键与 URL 参数 */
export function distributionSignature(distribution: Distribution): string {
  return ROLE_ORDER.map((role) => distribution[role]).join(',');
}

/** 解析签名；非法时返回 null */
export function parseDistribution(signature: string): Distribution | null {
  const parts = signature.split(',').map((part) => Number(part));
  if (
    parts.length !== ROLE_ORDER.length ||
    parts.some((n) => !Number.isInteger(n) || n < 0)
  ) {
    return null;
  }
  const out = {} as Distribution;
  ROLE_ORDER.forEach((role, index) => {
    out[role] = parts[index]!;
  });
  return out;
}
