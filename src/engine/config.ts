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
  | 'twoOthersWithCards'; // 指定两名有手牌的其他玩家

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
  | 'peekHand'; // 窥牌

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
};

/**
 * 水晶编号 -> 技能。
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

export function skillOfCrystal(crystal: number): SkillId {
  const skill = CRYSTAL_TO_SKILL[crystal];
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
