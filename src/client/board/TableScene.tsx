import { type ReactNode } from 'react';

/**
 * 牌桌场景容器（步骤 4 · A2 / A4）：桌面 + 席位环绕 + 中央版图，或退化为紧凑列表（兜底）。
 *
 * 职责边界：**它只管容器与兜底切换**——席位坐标由 Board 用共享纯函数
 * [`seatLayout`](../scene.ts) 算好后写在各自的行内样式上（`.player-line` 的 `left/top`），
 * 这里不重复一套布局算法。椭圆形状由容器宽高比决定（桌面端拉宽、窄屏压扁），
 * 因此同一份归一化坐标在两端得到两种观感。
 *
 * `center`（A4）是要收进桌心的「版图」：环绕模式下渲染到 `.table-center`——版图不再单独占
 * 一块面板，而是坐在席位环中间，与桌面共同构成完整场景；紧凑列表模式下退回改造前的独立
 * `.panel`（含「版图」标题），保证兜底视图与改造前一致。
 *
 * `compact` 是方案 §5.2 的兜底视图：10 人局或窄屏时按座位序竖排，沿用既有
 * `.players` / `.player-line` 样式，观感与改造前的「玩家区」完全一致（此时行内的
 * left/top 对静态定位元素不产生效果）。
 */
export function TableScene({
  compact,
  center,
  children,
}: {
  compact: boolean;
  /** 桌心版图（环绕模式）／独立「版图」面板（紧凑模式） */
  center?: ReactNode;
  children: ReactNode;
}) {
  if (compact) {
    return (
      <>
        {center && (
          <div className="panel">
            <h2>版图</h2>
            {center}
          </div>
        )}
        <div className="players">{children}</div>
      </>
    );
  }
  return (
    <div className="table-scene">
      {/* 环的坐标空间：左右各留出安全边距，因为 seatLayout 的 x 会取到 0 与 1 附近的极值 */}
      <div className="table-ring">{children}</div>
      {center && <div className="table-center">{center}</div>}
    </div>
  );
}
