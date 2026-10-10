import { ROLE_LABEL, hasBudIcon, isBladeCard, isWhiteRoseCard, type Card } from '../engine';

/** 卡牌的显示名（幽魂 / 信者 / 角色名） */
export function cardLabel(card: Card): string {
  if (card.kind === 'ghost') return '幽魂';
  if (card.kind === 'believer') return '信者';
  return ROLE_LABEL[card.role];
}

/**
 * 卡牌标记：
 *  - 司教 / 信者带花苞，用黄色小花 ❀
 *  - 白蔷薇不带花苞，用白色蔷薇 ✿ 单独标识（不与花苞混淆）
 *  - 血刃阵营牌用剑标记
 */
export function CardMark({ card }: { card: Card }) {
  if (isWhiteRoseCard(card)) {
    return (
      <em className="rose" title="白蔷薇">
        ✿
      </em>
    );
  }
  if (hasBudIcon(card)) {
    return (
      <em className="bud" title="花苞">
        ❀
      </em>
    );
  }
  if (isBladeCard(card)) {
    return (
      <em className="blade" title="血刃">
        ⚔
      </em>
    );
  }
  return null;
}

/** 卡牌正面（牌名 + 标记），牌桌与公开结算动画共用 */
export function CardChip({ card }: { card: Card }) {
  const tone = isBladeCard(card)
    ? 'blade'
    : isWhiteRoseCard(card)
      ? 'rose'
      : hasBudIcon(card)
        ? 'bud'
        : '';
  return (
    <span className={`chip${tone ? ` chip-${tone}` : ''}`}>
      {cardLabel(card)}
      <CardMark card={card} />
    </span>
  );
}