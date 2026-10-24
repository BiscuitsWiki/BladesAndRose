import type { ReactNode } from 'react';
import { HallEmblem } from '../artwork';

/**
 * 牌桌场景（2026-10-18 改版）：顶行 / 中间（左翼·桌心水印·右翼）/ 底行（自区）三行结构。
 *
 * 职责边界：**它只管容器与排布**——哪些席位落在哪个分区由 Board 用共享纯函数
 * [`seatLayout`](../scene.ts) 分好组后按 `top / left / right / bottom` 传入，
 * 这里按段排布，不做任何定位运算。席位卡宽度随视口收缩、高度由内容决定
 * （身份行 + 资源行 + 两行标注）；中央自然空出来留给纹章水印（压在席位卡下层、
 * 不拦截交互）。
 *
 * - 两翼是**纵排**（9–10 人局各 3 张、7–8 人局各 2 张、5–6 人局各 1 张），DOM 顺序即 `col` 升序；
 *   左翼由 CSS 反向（`column-reverse`）让 col 0 的下家贴向自己；
 *   `.table-mid` 的 min-height 按两翼行数分档预留（`wingRows` 3 或 2），
 *   同档内人数不同桌布高度一致、不随人数增减跳动；
 * - 底行是**当前视角玩家独享的自区**（左＝自己的席位卡，右＝手牌空间），
 *   由 Board 组装好后整块传入，渲染为牌桌**外**的独立 `.self-console` 面板
 *   （与桌面明显分隔，不再共用桌布底色）；
 * - 紧凑列表（手动兜底视图）不经过本组件——由 Board 直接渲染
 *   `.players` 竖排列表（席位按座位序，观感与改造前的「玩家区」一致）。
 */
export function TableScene({
  wingRows,
  top,
  left,
  right,
  bottom,
}: {
  /** 两翼纵排行数（9–10 人局 3、其余 2）：决定 `.table-mid` 的高度分档 */
  wingRows: 2 | 3;
  /** 顶行席位（2–3 张，横排居中） */
  top: ReactNode;
  /** 左翼席位（0–3 张，纵排） */
  left: ReactNode;
  /** 右翼席位（0–3 张，纵排） */
  right: ReactNode;
  /** 底行自区（自己那 1 席 + 手牌空间），渲染为牌桌下方的独立面板 */
  bottom: ReactNode;
}) {
  return (
    <>
      <div className={`table-scene${wingRows === 3 ? ' wings-3' : ''}`}>
        <div className="table-row">{top}</div>
        <div className="table-mid">
          <div className="table-wing left">{left}</div>
          {/* 桌心纹章水印：纯装饰，z-index 低于席位卡（2）且 pointer-events: none */}
          <div className="table-center" aria-hidden="true">
            <div className="table-watermark">
              <HallEmblem />
            </div>
          </div>
          <div className="table-wing right">{right}</div>
        </div>
      </div>
      <div className="self-console">{bottom}</div>
    </>
  );
}
