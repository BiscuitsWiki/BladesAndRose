import { SKILLS, skillDef, type MagicTargetSpec, type SkillId } from './config';
import { nextInt } from './rng';
import { makeGhostCard, orderFrom, playerById } from './setup';
import type { Card, GameState, PlayerId } from './types';

export function targetSpecOf(skill: SkillId): MagicTargetSpec {
  return SKILLS[skill].targets;
}

export interface ResolvedTargets {
  /** 必须（也恰好）选择的人数 */
  need: number;
  /** 可选目标池（按玩家顺序） */
  pool: PlayerId[];
}

/**
 * 把技能的目标规格解析为本局的动态目标：需要选几人、可选池有哪些。
 * 引擎校验（resolveMagicTargets）、客户端选择 UI（playerView 下发）、autoPlay 三处共用。
 */
export function resolveTargets(state: GameState, skill: SkillId, chooserId: PlayerId): ResolvedTargets {
  return resolveTargetsForSpec(state, chooserId, targetSpecOf(skill));
}

export function resolveTargetsForSpec(
  state: GameState,
  chooserId: PlayerId,
  spec: MagicTargetSpec,
): ResolvedTargets {
  const all = state.players.map((p) => p.id);
  const others = all.filter((id) => id !== chooserId);
  switch (spec) {
    case 'none':
      return { need: 0, pool: [] };
    case 'oneAny':
      return { need: 1, pool: all };
    case 'oneOther':
      return { need: 1, pool: others };
    case 'oneOtherWithCards': {
      // 必选数按目标池收敛：手牌随对局枯竭，池不足时若仍要求足额目标，
      // magicTargets 阶段会没有任何合法动作，对局永久卡死
      const pool = others.filter((id) => hasCards(state, id));
      return { need: Math.min(1, pool.length), pool };
    }
    case 'twoOthersWithCards': {
      const pool = others.filter((id) => hasCards(state, id));
      return { need: Math.min(2, pool.length), pool };
    }
    case 'oneOrTwoOthersWithCards': {
      // 扩充 5 号：可选数 = min(2, 池大小)（≥2 必选 2；=1 选 1；=0 无可选）
      const pool = others.filter((id) => hasCards(state, id));
      return { need: Math.min(2, pool.length), pool };
    }
    case 'oneOrTwoOthers': {
      // 扩充 2 号：8 人局以上指定 2 人，否则 1 人
      return { need: state.playerCount >= 8 ? 2 : 1, pool: others };
    }
  }
}

function neighborId(state: GameState, id: PlayerId, offset: number): PlayerId {
  const n = state.playerCount;
  const idx = state.order.indexOf(id);
  return state.order[(((idx + offset) % n) + n) % n]!;
}

/** 左邻 = 顺时针方向的下一位 */
export function leftNeighbor(state: GameState, id: PlayerId): PlayerId {
  return neighborId(state, id, 1);
}

/** 右邻 = 逆时针方向的下一位 */
export function rightNeighbor(state: GameState, id: PlayerId): PlayerId {
  return neighborId(state, id, -1);
}

export function hasCards(state: GameState, id: PlayerId): boolean {
  return playerById(state, id).hand.length > 0;
}

type SkillEffect = (state: GameState, chooserId: PlayerId, targets: PlayerId[]) => void;

/**
 * 技能 = 插件（SkillId → SkillEffect）：效果函数只负责写「本轮效果」字段 / 知识 / 牌区，
 * 流程代码（game.ts 的决策点）只读 RoundModifiers 里的字段，永不过问技能版本。
 * 展示数据（name / text / targets）在 config.ts 的 SKILLS 表，两者按 SkillId 对应。
 */
const EFFECTS: Record<SkillId, SkillEffect> = {
  forcePlay: (state, chooserId, targets) => {
    const def = skillDef('forcePlay');
    const chooser = playerById(state, chooserId);
    const t0 = targets[0];
    if (t0 && hasCards(state, t0)) {
      state.modifiers.mustPlay.push(t0);
      state.log.push(`${chooser.name} 用【${def.name}】指定 ${playerById(state, t0).name} 本回合必须出牌`);
    } else {
      state.log.push(`${chooser.name} 的【${def.name}】无法结算，跳过`);
    }
  },

  revealInOrder: (state) => {
    state.modifiers.revealInOrder = true;
    state.log.push(`本轮卡牌按出牌顺序公开（【${skillDef('revealInOrder').name}】）`);
  },

  rightNeighborRandom: (state, chooserId) => {
    const def = skillDef('rightNeighborRandom');
    const side = '右邻（上家）';
    const target = rightNeighbor(state, chooserId);
    if (hasCards(state, target)) {
      state.modifiers.mustPlayRandom.push(target);
      state.log.push(`${side} ${playerById(state, target).name} 本回合必须随机出牌`);
    } else {
      state.log.push(`${side} 已无手牌，【${def.name}】跳过`);
    }
  },

  leftNeighborRandom: (state, chooserId) => {
    const def = skillDef('leftNeighborRandom');
    const side = '左邻（下家）';
    const target = leftNeighbor(state, chooserId);
    if (hasCards(state, target)) {
      state.modifiers.mustPlayRandom.push(target);
      state.log.push(`${side} ${playerById(state, target).name} 本回合必须随机出牌`);
    } else {
      state.log.push(`${side} 已无手牌，【${def.name}】跳过`);
    }
  },

  pairAction: (state, _chooserId, targets) => {
    const def = skillDef('pairAction');
    const t0 = targets[0];
    const t1 = targets[1];
    if (t0 && t1 && hasCards(state, t0) && hasCards(state, t1)) {
      // 先行动者为 A，随后 B 必须与 A 保持一致
      const order = state.playOrder;
      const [a, b] = order.indexOf(t0) < order.indexOf(t1) ? [t0, t1] : [t1, t0];
      state.modifiers.pairs.push([a!, b!]);
      state.log.push(`${playerById(state, a!).name} 与 ${playerById(state, b!).name} 行动绑定`);
    } else {
      state.log.push(`【${def.name}】无法结算，跳过`);
    }
  },

  goLast: (state, chooserId) => {
    state.modifiers.goLastOption = chooserId;
    state.log.push(`${playerById(state, chooserId).name} 可以选择最后行动`);
  },

  gainGhost: (state, chooserId, targets) => {
    const def = skillDef('gainGhost');
    const t0 = targets[0];
    // 直接新增一张幽魂，不消耗幽魂弃牌堆；目标可以是自己
    if (t0) {
      const target = playerById(state, t0);
      target.hand.push(makeGhostCard());
      state.log.push(
        `${playerById(state, chooserId).name} 用【${def.name}】让 ${target.name} 额外获得一枚幽魂`,
      );
    }
  },

  bothNeighborsPlay: (state, chooserId) => {
    const def = skillDef('bothNeighborsPlay');
    const sides: [string, PlayerId][] = [
      ['左邻（下家）', leftNeighbor(state, chooserId)],
      ['右邻（上家）', rightNeighbor(state, chooserId)],
    ];
    sides.forEach(([side, id]) => {
      if (hasCards(state, id)) {
        if (!state.modifiers.mustPlay.includes(id)) state.modifiers.mustPlay.push(id);
        state.log.push(`${side} ${playerById(state, id).name} 本回合必须出牌`);
      } else {
        state.log.push(`${side} 已无手牌，【${def.name}】跳过`);
      }
    });
  },

  darkBladeScout: (state) => {
    // 白蔷薇与暗刃每局必有且仅有一名（配比校验保证）
    const darkBlade = state.players.find((p) => p.role === 'darkBlade')!;
    // 只给名单，不给「谁是白蔷薇、谁是司教」的对应关系
    const scouted = state.players
      .filter((p) => p.role === 'whiteRose' || p.role === 'bishop')
      .map((p) => p.id);
    state.knowledge[darkBlade.id]!.push({ kind: 'scoutedRoles', players: scouted });
    state.log.push('暗刃查看了白蔷薇与司教的名单');
  },

  replacePlayedCard: (state, chooserId) => {
    state.modifiers.redrawOption = chooserId;
    state.log.push(`${playerById(state, chooserId).name} 可在公开前指定一人换牌`);
  },

  peekHand: (state, chooserId, targets) => {
    const def = skillDef('peekHand');
    const t0 = targets[0];
    if (t0) {
      const target = playerById(state, t0);
      if (target.hand.length > 0) {
        const card: Card = target.hand[nextInt(state, target.hand.length)]!;
        state.knowledge[chooserId]!.push({ kind: 'peekedCard', target: t0, card });
        state.log.push(`${playerById(state, chooserId).name} 随机查看了 ${target.name} 的一张手牌`);
      } else {
        state.log.push(`${target.name} 没有手牌，【${def.name}】跳过`);
      }
    }
  },

  // ---------------------------------------------------------- 2025 扩充包

  forcePass: (state, chooserId, targets) => {
    const def = skillDef('forcePass');
    const chooser = playerById(state, chooserId);
    const valid = targets.filter((t) => state.players.some((p) => p.id === t));
    if (valid.length > 0) {
      valid.forEach((t) => {
        if (!state.modifiers.mustPass.includes(t)) state.modifiers.mustPass.push(t);
      });
      const names = valid.map((t) => playerById(state, t).name).join('、');
      state.log.push(`${chooser.name} 用【${def.name}】指定 ${names} 本回合不可出牌`);
    } else {
      state.log.push(`${chooser.name} 的【${def.name}】无法结算，跳过`);
    }
  },

  randomPlay: (state) => {
    state.modifiers.randomPlay = true;
    state.log.push(`本轮出牌由系统随机抽取（【${skillDef('randomPlay').name}】）`);
  },

  twoLapPlay: (state) => {
    state.modifiers.laps = 2;
    state.log.push(`本轮出牌进行两圈，每人两次机会（【${skillDef('twoLapPlay').name}】）`);
  },

  trioPlay: (state, chooserId, targets) => {
    const def = skillDef('trioPlay');
    const chooser = playerById(state, chooserId);
    // 集合 = 自己（若有手牌）+ 选中目标（目标池本就要求有手牌，这里按实况再验一次）
    const members = [
      ...(hasCards(state, chooserId) ? [chooserId] : []),
      ...targets.filter((t) => state.players.some((p) => p.id === t) && hasCards(state, t)),
    ];
    state.modifiers.trio = members;
    // 集合内必须各出 1 张：写入 mustPlay；集合外玩家因 playOrder 收窄而自动跳过
    members.forEach((id) => {
      if (!state.modifiers.mustPlay.includes(id)) state.modifiers.mustPlay.push(id);
    });
    if (members.length === 0) {
      state.log.push(`${chooser.name} 的【${def.name}】无人可以出牌，本轮无人出牌`);
    } else {
      const names = members.map((id) => playerById(state, id).name).join('、');
      state.log.push(`${chooser.name} 用【${def.name}】召集 ${names} 共同出牌`);
    }
  },

  preShufflePick: (state, chooserId) => {
    const def = skillDef('preShufflePick');
    const chooser = playerById(state, chooserId);
    // 待选池在「公开前决策」时点才展开（那时「未出牌」才有意义），这里只登记由谁决策
    state.modifiers.pendingPick = { chooser: chooserId, pool: [] };
    state.log.push(`${chooser.name} 可在洗牌前指定一名未出牌玩家补出（【${def.name}】）`);
  },

  bishopMustPlay: (state) => {
    state.modifiers.bishopMustPlay = true;
    state.log.push(`本轮司教若持有手牌则必须出牌（【${skillDef('bishopMustPlay').name}】）`);
  },

  noGhost: (state) => {
    state.modifiers.noGhost = true;
    state.log.push(`本轮不可打出幽魂牌（【${skillDef('noGhost').name}】）`);
  },

  earlyReveal: (state) => {
    state.modifiers.revealAtCount = 3;
    state.log.push(`本轮出到第 3 张牌立即混洗公开（【${skillDef('earlyReveal').name}】）`);
  },
};

/**
 * 结算魔法技能。需要选目标的技能会先被挂起到 pendingMagic，
 * 因此这里收到的 targets 已经过校验。
 */
export function applySkill(
  state: GameState,
  skill: SkillId,
  chooserId: PlayerId,
  targets: PlayerId[],
): void {
  EFFECTS[skill](state, chooserId, targets);
}

/** 校验一名玩家能否被指定为该技能的目标（是否在目标池内，且未被重复选择） */
export function canTarget(
  state: GameState,
  chooserId: PlayerId,
  candidate: PlayerId,
  spec: MagicTargetSpec,
  alreadyChosen: PlayerId[] = [],
): boolean {
  if (alreadyChosen.includes(candidate)) return false;
  if (!state.players.some((p) => p.id === candidate)) return false;
  return resolveTargetsForSpec(state, chooserId, spec).pool.includes(candidate);
}

/** 该轮出牌阶段的基准顺序：从受币者起顺时针，每人一次 */
export function basePlayOrder(state: GameState, receiverId: PlayerId): PlayerId[] {
  return orderFrom(state, receiverId);
}