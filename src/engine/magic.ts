import { SKILLS, skillDef, type MagicTargetSpec, type SkillId } from './config';
import { nextInt } from './rng';
import { makeGhostCard, orderFrom, playerById } from './setup';
import type { Card, GameState, PlayerId } from './types';

export function targetSpecOf(skill: SkillId): MagicTargetSpec {
  return SKILLS[skill].targets;
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
  const def = skillDef(skill);
  const chooser = playerById(state, chooserId);
  const t0 = targets[0];
  const t1 = targets[1];

  switch (skill) {
    case 'forcePlay': {
      if (t0 && hasCards(state, t0)) {
        state.modifiers.mustPlay.push(t0);
        state.log.push(`${chooser.name} 用【${def.name}】指定 ${playerById(state, t0).name} 本回合必须出牌`);
      } else {
        state.log.push(`${chooser.name} 的【${def.name}】无法结算，跳过`);
      }
      break;
    }
    case 'revealInOrder': {
      state.modifiers.revealInOrder = true;
      state.log.push(`本轮卡牌按出牌顺序公开（【${def.name}】）`);
      break;
    }
    case 'rightNeighborRandom':
    case 'leftNeighborRandom': {
      const isRight = skill === 'rightNeighborRandom';
      const side = isRight ? '右邻（上家）' : '左邻（下家）';
      const target = isRight ? rightNeighbor(state, chooserId) : leftNeighbor(state, chooserId);
      if (hasCards(state, target)) {
        state.modifiers.mustPlayRandom.push(target);
        state.log.push(`${side} ${playerById(state, target).name} 本回合必须随机出牌`);
      } else {
        state.log.push(`${side} 已无手牌，【${def.name}】跳过`);
      }
      break;
    }
    case 'pairAction': {
      if (t0 && t1 && hasCards(state, t0) && hasCards(state, t1)) {
        // 先行动者为 A，随后 B 必须与 A 保持一致
        const order = state.playOrder;
        const [a, b] = order.indexOf(t0) < order.indexOf(t1) ? [t0, t1] : [t1, t0];
        state.modifiers.pairs.push([a!, b!]);
        state.log.push(`${playerById(state, a!).name} 与 ${playerById(state, b!).name} 行动绑定`);
      } else {
        state.log.push(`【${def.name}】无法结算，跳过`);
      }
      break;
    }
    case 'goLast': {
      state.modifiers.goLastOption = chooserId;
      state.log.push(`${chooser.name} 可以选择最后行动`);
      break;
    }
    case 'gainGhost': {
      // 直接新增一张幽魂，不消耗幽魂弃牌堆；目标可以是自己
      if (t0) {
        const target = playerById(state, t0);
        target.hand.push(makeGhostCard());
        state.log.push(`${chooser.name} 用【${def.name}】让 ${target.name} 额外获得一枚幽魂`);
      }
      break;
    }
    case 'bothNeighborsPlay': {
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
      break;
    }
    case 'darkBladeScout': {
      // 白蔷薇与暗刃每局必有且仅有一名（配比校验保证）
      const darkBlade = state.players.find((p) => p.role === 'darkBlade')!;
      // 只给名单，不给「谁是白蔷薇、谁是司教」的对应关系
      const scouted = state.players
        .filter((p) => p.role === 'whiteRose' || p.role === 'bishop')
        .map((p) => p.id);
      state.knowledge[darkBlade.id]!.push({ kind: 'scoutedRoles', players: scouted });
      state.log.push('暗刃查看了白蔷薇与司教的名单');
      break;
    }
    case 'replacePlayedCard': {
      state.modifiers.redrawOption = chooserId;
      state.log.push(`${chooser.name} 可在公开前指定一人换牌`);
      break;
    }
    case 'peekHand': {
      if (t0) {
        const target = playerById(state, t0);
        if (target.hand.length > 0) {
          const card: Card = target.hand[nextInt(state, target.hand.length)]!;
          state.knowledge[chooserId]!.push({ kind: 'peekedCard', target: t0, card });
          state.log.push(`${chooser.name} 随机查看了 ${target.name} 的一张手牌`);
        } else {
          state.log.push(`${target.name} 没有手牌，【${def.name}】跳过`);
        }
      }
      break;
    }
    default: {
      const never: never = skill;
      throw new Error(`未知技能：${never}`);
    }
  }
}

/** 校验一名玩家能否被指定为该技能的目标 */
export function canTarget(
  state: GameState,
  chooserId: PlayerId,
  candidate: PlayerId,
  spec: MagicTargetSpec,
  alreadyChosen: PlayerId[] = [],
): boolean {
  // 只有 oneAny 允许把自己作为目标，其余技能都要求「其他玩家」
  if (candidate === chooserId && spec !== 'oneAny') return false;
  if (alreadyChosen.includes(candidate)) return false;
  if (!state.players.some((p) => p.id === candidate)) return false;
  if (spec === 'oneOtherWithCards' || spec === 'twoOthersWithCards') {
    return hasCards(state, candidate);
  }
  return true;
}

/** 该轮出牌阶段的基准顺序：从受币者起顺时针，每人一次 */
export function basePlayOrder(state: GameState, receiverId: PlayerId): PlayerId[] {
  return orderFrom(state, receiverId);
}
