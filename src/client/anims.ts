/**
 * 动效编排（纯逻辑，便于单测）：「上一帧 → 当前帧」的状态差异 → 该播哪些动效。
 *
 * 与 `revealAnim.ts` 同一模式：本文件只决定「播什么、播多久」，不碰任何渲染。
 * 三条实现原则（见 docs/UI-OVERHAUL-PLAN.md §7）：
 *   1. 编排是纯函数，渲染只消费指令；
 *   2. 一切动效都要能被 prefers-reduced-motion 关闭；
 *   3. 动画只解释「已经发生的状态变化」，绝不反向影响 moves。
 */

/** 动效时长（毫秒） */
export const COIN_FLIGHT_MS = 500;
export const CRYSTAL_PULSE_MS = 800;
export const TURN_PULSE_MS = 900;

/** 参与判定的状态快照：只取与动效有关的字段 */
export interface AnimSnapshot {
  /** 当前持币者（`GameView.coinHolder` 恒有值） */
  coinHolder: string;
  /** 已放上版图的水晶数，用于判定「刚发动了一枚水晶」 */
  crystalsPlaced: number;
  /** 刚放上版图那枚水晶的主人（`crystalTrack` 末条），无则 null */
  lastCrystalBy: string | null;
  /** 当前行动者，阶段交替时可能为 null */
  currentActor: string | null;
}

export interface AnimPlan {
  /** 硬币从这位座位飞给下一位（传币） */
  coin: { from: string; to: string } | null;
  /** 刚发动水晶的座位（轮次轨道高亮 + 技能名浮现 + 该座位脉冲） */
  crystal: string | null;
  /** 该脉冲提醒「轮到他了」 */
  turn: string | null;
}

/** 无动效的空计划 */
const NO_ANIMS: AnimPlan = { coin: null, crystal: null, turn: null };

/**
 * 比较两帧快照，得出该播的动效。
 *
 * - `prev` 为 null（首次挂载 / 刷新 / 热座切视角重建 client）时**一律不播**：
 *   这些情况下画面本就是从零渲染，没有「变化」可以解释，播动画反而莫名其妙。
 * - `reduceMotion` 为真时一律不播（无障碍）。
 * - 各字段只在「确实发生变化」时才出结果，避免无谓地重播。
 */
export function planAnims(
  prev: AnimSnapshot | null,
  next: AnimSnapshot,
  reduceMotion: boolean,
): AnimPlan {
  if (prev === null || reduceMotion) return NO_ANIMS;

  const coin =
    prev.coinHolder === next.coinHolder
      ? null
      : { from: prev.coinHolder, to: next.coinHolder };

  const crystal =
    next.crystalsPlaced > prev.crystalsPlaced && next.lastCrystalBy !== null
      ? next.lastCrystalBy
      : null;

  const turn =
    next.currentActor !== null && next.currentActor !== prev.currentActor
      ? next.currentActor
      : null;

  return { coin, crystal, turn };
}
