/** 公开结算动画的时长常量（毫秒）：前 3 秒翻牌，后 2 秒飞向结算区 */
export const REVEAL_FLIP_MS = 3000;
export const REVEAL_FLY_MS = 2000;
export const REVEAL_TOTAL_MS = REVEAL_FLIP_MS + REVEAL_FLY_MS;

/** 用户是否要求减弱动效（无障碍）：减弱时整幕跳过 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/**
 * 决定本轮是否播放结算动画（纯逻辑，便于单测）：
 *  - 没有结算或没有牌（无人出牌的轮次）时不播；
 *  - 同一轮只播一次（seen 记录已消费的轮次）；挂载时已有的结算视为已消费（刷新不重播）；
 *  - 结算被清空（重开一局）时复位去重记录；
 *  - prefers-reduced-motion 只消费轮次、不播。
 */
export function decideRevealAnim(
  seen: number | null,
  reveal: { round: number; cards: unknown[] } | null,
  reduceMotion: boolean,
): { seen: number | null; play: boolean } {
  if (!reveal || reveal.cards.length === 0) return { seen: null, play: false };
  if (seen === reveal.round) return { seen, play: false };
  return { seen: reveal.round, play: !reduceMotion };
}