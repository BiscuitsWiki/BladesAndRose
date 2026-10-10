import type { GameView } from '../engine';

/**
 * 版面上的按钮可用性判断。
 * 抽成纯函数便于单元测试——按钮的「显示 / 禁用」条件不再散落在 JSX 里。
 */

export interface HandActions {
  /** 是否显示「我要最后行动」：持有殿后权、尚未使用，且未选中手牌 */
  canGoLast: boolean;
  /** 是否显示「确认出这张牌 / 取消」：已选中一张手牌 */
  canConfirm: boolean;
  /** 「跳过」是否可点：被强制出牌的回合、或 10 号换牌挂起时禁用 */
  canSkip: boolean;
}

/**
 * 手牌面板在出牌阶段的操作；返回 null 表示这一排按钮不显示
 * （只有轮到自己、且处于出牌阶段才出现）。
 */
export function handActions(
  G: GameView,
  viewerId: string | null,
  pickedCardId: string | null,
): HandActions | null {
  if (viewerId === null || G.phase !== 'play' || G.currentActor !== viewerId) return null;
  /** 10 号换牌挂起：这不是普通出牌回合，只能选一张牌完成对调 */
  const swapping = G.pendingRedraw === viewerId;
  return {
    canGoLast:
      !swapping &&
      G.modifiers.goLastOption === viewerId &&
      !G.modifiers.goLastUsed &&
      pickedCardId === null,
    canConfirm: pickedCardId !== null,
    canSkip: !swapping && !G.modifiers.mustPlay.includes(viewerId),
  };
}

/**
 * 玩家区是否显示换牌阶段的「放弃换牌」。
 * 出牌阶段的动作已全部移入手牌面板，玩家区在出牌阶段不再有任何按钮。
 */
export function canResolveRedraw(G: GameView, viewerId: string | null): boolean {
  return viewerId !== null && G.phase === 'redraw' && G.currentActor === viewerId;
}