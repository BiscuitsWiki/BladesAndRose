import type { ReactNode } from 'react';
import { HallEmblem } from '../artwork';

/**
 * 牌桌场景容器（步骤 4 · A2 / A4；2026-10-17 改版）：席位环绕 + 桌心纹章水印，或紧凑列表。
 *
 * 职责边界：**它只管容器与兜底切换**——席位坐标由 Board 用共享纯函数
 * [`seatLayout`](../scene.ts) 算好后写在各自的行内样式上（`.player-line` 的 `left/top`），
 * 这里不重复一套布局算法。椭圆形状由容器宽高比决定（桌面端拉宽、窄屏压扁），
 * 因此同一份归一化坐标在两端得到两种观感。
 *
 * 版图（出牌公式区域）已移出本组件——由 Board 统一渲染在牌桌 / 玩家列表**上方**
 * 的全宽独立面板（两种模式顺序一致）；环绕模式的桌心只留低透明度纹章水印撑场景感。
 *
 * `compact` 是方案 §5.2 的兜底视图：10 人局或窄屏时按座位序竖排，沿用既有
 * `.players` / `.player-line` 样式，观感与改造前的「玩家区」完全一致（此时行内的
 * left/top 对静态定位元素不产生效果）。
 */
export function TableScene({ compact, children }: { compact: boolean; children: ReactNode }) {
  if (compact) {
    return <div className="players">{children}</div>;
  }
  return (
    <div className="table-scene">
      {/* 环的坐标空间：左右各留出安全边距，因为 seatLayout 的 x 会取到 0 与 1 附近的极值 */}
      <div className="table-ring">{children}</div>
      {/* 桌心纹章水印：纯装饰，z-index 低于席位卡（2）且 pointer-events: none */}
      <div className="table-center" aria-hidden="true">
        <div className="table-watermark">
          <HallEmblem />
        </div>
      </div>
    </div>
  );
}
