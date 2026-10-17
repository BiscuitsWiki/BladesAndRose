import { type ReactNode } from 'react';

/**
 * 牌桌场景容器（步骤 4 · A2 / A4）：桌面 + 席位环绕 + 中央版图，或退化为紧凑列表（兜底）。
 *
 * 职责边界：**它只管容器与兜底切换**——席位坐标由 Board 用共享纯函数
 * [`seatLayout`](../scene.ts) 算好后写在各自的行内样式上（`.player-line` 的 `left/top`），
 * 这里不重复一套布局算法。椭圆形状由容器宽高比决定（桌面端拉宽、窄屏压扁），
 * 因此同一份归一化坐标在两端得到两种观感。
 *
 * `center`（2026-10-17 改版）：紧凑列表模式传「版图」面板内容（渲染成独立面板）；
 * 环绕模式传纹章水印（桌心不再放版图——版图移回全宽独立面板，桌心只撑场景感）。
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
  /** 紧凑模式：独立「版图」面板内容（渲染在玩家列表下方）；环绕模式：桌心纹章水印 */
  center?: ReactNode;
  children: ReactNode;
}) {
  if (compact) {
    return (
      <>
        {/* 玩家列表在上、版图在下——与环绕模式（牌桌在上、版图面板在下）保持一致 */}
        <div className="players">{children}</div>
        {center && (
          <div className="panel">
            <h2>版图</h2>
            {center}
          </div>
        )}
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
