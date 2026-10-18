import { type Card } from '../engine';
import { RoseMark } from './artwork';
import { cardFaceOf } from './scene';

/** 卡牌的显示名（幽魂 / 信者 / 角色名）；映射本体在共享层 `scene.ts` 的 `cardFaceOf` */
export function cardLabel(card: Card): string {
  return cardFaceOf(card).label;
}

/**
 * 卡面对应的画心文件：`assets/cards/card-<kind>.webp`。
 * 幽魂与信者有各自的画心；角色牌直接用角色名（信者角色与固定信者共用同一张）。
 * 原始高分辨率 JPG 留档在 `assets-source/cards/`（不参与构建）。
 * 映射本体在共享层 `scene.ts` 的 `cardFaceOf`。
 */
export function cardArtKind(card: Card): string {
  return cardFaceOf(card).kind;
}

/**
 * 四角装饰卷叶：只含弧线与圆点、**不含直线**——
 * 直线一律由 CSS 金线负责，因此两者不可能错位（早期版本用带直线的角饰踩过这个坑）。
 */
function CornerOrnament() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 11.4 A8.4 8.4 0 0 1 11.4 3" stroke="currentColor" strokeWidth="1.1" opacity=".8" />
      <path
        d="M11.4 3 c-1.5 4.3 -4.1 6.9 -8.4 8.4 1.5 -4.3 4.1 -6.9 8.4 -8.4 Z"
        fill="currentColor"
        opacity=".9"
      />
      <circle cx="4.6" cy="4.6" r="1.05" fill="currentColor" />
    </svg>
  );
}

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

/**
 * 卡面 = 上半「画心面板」（画心 + 金线 + 四角饰花）+ 下半独立「卡名条」。
 *
 * - 画心用 `background-size: cover` 填满面板，主体居中；
 * - 卡框与卡名由程序渲染，故多张卡绝对一致、改文案零成本、且不会被卡槽裁掉；
 * - 尺寸变体（mini / hand / reveal / fill）见 styles.css，均保持 2:3。
 */
export function CardFace({
  card,
  size = 'hand',
  title,
}: {
  card: Card;
  size?: 'mini' | 'hand' | 'reveal' | 'fill';
  title?: string;
}) {
  return (
    <span className={`cardface ${size}`} title={title}>
      <span className="cardface-panel">
        <span
          className="cardface-art"
          style={{ backgroundImage: `url(assets/cards/card-${cardArtKind(card)}.webp)` }}
        />
        {CORNERS.map((position) => (
          <span key={position} className={`cardface-corner ${position}`}>
            <CornerOrnament />
          </span>
        ))}
      </span>
      <span className="cardface-name">{cardLabel(card)}</span>
    </span>
  );
}

/**
 * 卡背：手牌不可见时的占位（观战模式的自区）。
 *
 * 复用 `CardFace` 的卡框与四角饰花（同一套 `.cardface` 结构，尺寸变体共用），
 * 中央换成程序绘制的白玫瑰水印，**不带卡名条**——空白的下半部正好与「未知牌」同义。
 * 不引入任何位图资源（方案 §5.3 的「卡背」原本列的是待做位图，此处用程序画替代）。
 */
export function CardBack({ size = 'hand' }: { size?: 'mini' | 'hand' | 'reveal' | 'fill' }) {
  return (
    <span className={`cardface back ${size}`} aria-label="手牌（不可见）">
      <span className="cardface-panel">
        <span className="cardface-back-mark">
          <RoseMark />
        </span>
        {CORNERS.map((position) => (
          <span key={position} className={`cardface-corner ${position}`}>
            <CornerOrnament />
          </span>
        ))}
      </span>
    </span>
  );
}
