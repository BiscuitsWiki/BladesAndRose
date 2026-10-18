import type { ReactNode } from 'react';
import { HallEmblem } from '../artwork';

/**
 * 竖版牌桌场景（2026-10-18 改版）：顶行 / 中间（左·桌心水印·右）/ 底行 的三行结构。
 *
 * 职责边界：**它只管容器与排布**——哪些席位落在哪个分区由 Board 用共享纯函数
 * [`seatLayout`](../scene.ts) 分好组后按 `top / left / right / bottom` 传入，
 * 这里按段横排居中，不做任何定位运算。席位卡是 3:4 竖版卡、宽度随视口收缩，
 * 桌面因此纵向拉长；中央自然空出来留给纹章水印（压在席位卡下层、不拦截交互）。
 *
 * 紧凑列表兜底（9–10 人局 / 手动切换，方案 §5.2）不经过本组件——由 Board 直接渲染
 * `.players` 竖排列表（席位按座位序，观感与改造前的「玩家区」一致）。
 */
export function TableScene({
  top,
  left,
  right,
  bottom,
}: {
  /** 顶行席位（1–3 张，横排居中） */
  top: ReactNode;
  /** 左翼席位（1 张） */
  left: ReactNode;
  /** 右翼席位（1 张） */
  right: ReactNode;
  /** 底行席位（1–3 张：自己居中，或 6–7 人局时自己 + 下家同行，横排） */
  bottom: ReactNode;
}) {
  return (
    <div className="table-scene">
      <div className="table-row">{top}</div>
      <div className="table-mid">
        {left}
        {/* 桌心纹章水印：纯装饰，z-index 低于席位卡（2）且 pointer-events: none */}
        <div className="table-center" aria-hidden="true">
          <div className="table-watermark">
            <HallEmblem />
          </div>
        </div>
        {right}
      </div>
      <div className="table-row">{bottom}</div>
    </div>
  );
}
