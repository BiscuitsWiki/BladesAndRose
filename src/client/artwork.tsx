/**
 * 程序画的装饰性美术资源（UI 类 SVG，对应 UI-OVERHAUL-PLAN §5.3 的「SVG」行）。
 *
 * 定位与卡框一致——插画类用位图、UI 类用 SVG，这里收录后者：
 *   - 零依赖、纯展示（不 import engine、不读写状态），任何表现层都能复用；
 *   - 涉及「血 / 武器」的视觉一律程序画（AI 生图会被安全策略拦，见方案 §5.4）；
 *   - 颜色尽量跟随 currentColor 或显式声明，尺寸由外层容器决定；
 *   - 替换的是既有字形 / clip-path 视觉（❀ 花苞、👁 睁眼、clip-path 六边形），
 *     外层容器与类名一律不动——动效 CSS 咬死它们（track-hex 的 filled / launching 等）。
 */
import { useId } from 'react';

/**
 * 六边形水晶（未发动 / 已发动两态）：刻面宝石质感，替代原先的双层 clip-path 纯色块。
 * 编号文字由外层容器负责渲染（.crystal-body / .track-hex-body），本组件只画宝石本体。
 *
 * 结构：外六边形 + 顶面菱形高光（table facet）+ 两条通到底尖的内棱线，
 * 形成「三面体」的错觉；未发动走暗色 + 暗金描边，发动后走浅灰白渐变 + 白色高光。
 */
export function CrystalHex({ placed = false }: { placed?: boolean }) {
  const id = useId();
  const fillId = `crystal-${id}`;
  return (
    <svg viewBox="0 0 22 24" aria-hidden="true">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          {placed ? (
            <>
              <stop offset="0" stopColor="#ded9d6" />
              <stop offset="0.55" stopColor="#b6afac" />
              <stop offset="1" stopColor="#877e7a" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#39322e" />
              <stop offset="1" stopColor="#110d0b" />
            </>
          )}
        </linearGradient>
      </defs>
      {/* 外六边形（pointy-top）：顶点 (11,1)(21,7)(21,17)(11,23)(1,17)(1,7) */}
      <polygon
        points="11,1 21,7 21,17 11,23 1,17 1,7"
        fill={`url(#${fillId})`}
        stroke={placed ? 'rgba(255,255,255,0.5)' : 'rgba(216,178,106,0.4)'}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* 顶面菱形高光 */}
      <polygon
        points="11,4.4 16.2,7 11,9.6 5.8,7"
        fill={placed ? 'rgba(255,255,255,0.5)' : 'rgba(236,229,226,0.09)'}
        stroke={placed ? 'rgba(255,255,255,0.45)' : 'none'}
        strokeWidth="0.6"
      />
      {/* 两条内棱线：从菱形两腰通到底尖 */}
      <path
        d="M5.8 7 L11 21.6 M16.2 7 L11 21.6"
        fill="none"
        stroke={placed ? 'rgba(72,64,60,0.4)' : 'rgba(216,178,106,0.16)'}
        strokeWidth="0.7"
      />
    </svg>
  );
}

/**
 * 花苞（献祭 / 死亡两态）：替代原先的 ❀ 字形。
 * 死亡花苞 = 茎弯折、苞体垂向一侧、一片枯叶——与献祭花苞的直立形明显区分。
 */
export function BudMark({ dead = false }: { dead?: boolean }) {
  if (dead) {
    return (
      <svg viewBox="0 0 12 16" aria-hidden="true">
        {/* 弯折的茎 */}
        <path
          d="M5.4 15 Q5.8 10.6 8 8.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
        />
        {/* 垂向一侧的苞体 */}
        <path
          d="M8 8.2 C10.4 8.6 11.1 10.7 10.2 12.5 C8.5 12.2 7.5 10.5 8 8.2 Z"
          fill="rgba(162,144,139,0.22)"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
        {/* 一片枯叶 */}
        <path
          d="M4.4 12.8 Q2.9 12 2.7 10.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 12 16" aria-hidden="true">
      {/* 直立茎 */}
      <path
        d="M6 15 V9.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* 两片萼叶 */}
      <path
        d="M6 11.4 C4.2 11 3 9.6 2.8 7.8 C4.8 8.4 5.8 9.6 6 11.4 Z"
        fill="rgba(216,178,106,0.18)"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      <path
        d="M6 11.4 C7.8 11 9 9.6 9.2 7.8 C7.2 8.4 6.2 9.6 6 11.4 Z"
        fill="rgba(216,178,106,0.18)"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      {/* 苞体与中缝 */}
      <path
        d="M6 1.6 C8.4 3.4 9 5.6 8.4 7.4 C7.9 8.8 6.9 9.4 6 9.4 C5.1 9.4 4.1 8.8 3.6 7.4 C3 5.6 3.6 3.4 6 1.6 Z"
        fill="rgba(216,178,106,0.12)"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M6 3 V8.6" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.7" />
    </svg>
  );
}

/**
 * 睁眼标记：杏仁形轮廓 + 实心虹膜 + 高光点，替代原先的 👁 字形。
 * 描边与虹膜都跟 currentColor——槽位标注态（.marked 金色 / 系统标注）由现有 CSS 控制。
 * 元素显式声明 fill / stroke（继承链上 .eye-slot svg 的 fill:none 只会作用于未声明的元素）。
 */
export function OpenEyeMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.6 8 Q8 1.9 14.4 8 Q8 12.5 1.6 8 Z"
        fill="rgba(216,178,106,0.12)"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="7.7" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="8.9" cy="6.8" r="0.7" fill="rgba(255,255,255,0.85)" stroke="none" />
    </svg>
  );
}

/** 闭眼标记：下弯眼睑 + 三根睫毛（纯描边）。自 Board.tsx 移入，与睁眼成对管理。 */
export function ClosedEyeMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.1 6.2Q8 12.6 13.9 6.2" />
      <path d="M5.05 8.6L4.15 10.4M8 9.4V11.4M10.95 8.6L11.85 10.4" />
    </svg>
  );
}

/**
 * 大厅纹章：中央白玫瑰（五瓣外轮 + 内圈 + 金色花心）+ 两侧对称细刃 + 底部装饰弧线。
 * 「武器」类视觉按方案 §5.4 一律程序画；刃形遵循「刃根最宽、向刀尖单调收窄」的构造性描述。
 */
export function HallEmblem() {
  return (
    <svg className="hall-emblem" viewBox="0 0 320 96" aria-hidden="true">
      {/* 两侧细刃（对称复制，dir 翻转 x 轴） */}
      {[-1, 1].map((dir) => (
        <g key={dir} transform={`translate(${160 + dir * 78} 18) scale(${dir} 1)`}>
          <path
            d="M0 0 C3.4 9 3.4 24 0 38 C-3.4 24 -3.4 9 0 0 Z"
            fill="rgba(169,180,189,0.14)"
            stroke="#a9b4bd"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <path d="M-7 42 Q0 39.4 7 42" fill="none" stroke="#a9b4bd" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M0 43.5 V54" stroke="#a9b4bd" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="0" cy="57" r="2.6" fill="none" stroke="#a9b4bd" strokeWidth="1.4" />
        </g>
      ))}
      {/* 中央白玫瑰：五瓣外轮（旋转复制同一花瓣）+ 内圈与内瓣 + 金色花心 */}
      <g
        transform="translate(160 44)"
        stroke="#e6c7c4"
        strokeWidth="1.1"
        fill="rgba(230,199,196,0.1)"
        strokeLinejoin="round"
      >
        {Array.from({ length: 5 }, (_, i) => (
          <path
            key={i}
            transform={`rotate(${i * 72})`}
            d="M0 -27 C10.5 -22.5 12.5 -9.5 0 -3.5 C-12.5 -9.5 -10.5 -22.5 0 -27 Z"
          />
        ))}
        <circle r="11.5" fill="none" opacity="0.9" />
        <path d="M0 -11 C6 -7 6 3 0 7 C-6 3 -6 -7 0 -11 Z" fill="none" opacity="0.9" />
        <circle r="3" fill="#d8b26a" stroke="none" opacity="0.9" />
      </g>
      {/* 底部装饰弧线与端点 */}
      <path
        d="M52 86 Q160 97 268 86"
        fill="none"
        stroke="rgba(216,178,106,0.5)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle cx="52" cy="86" r="1.6" fill="#d8b26a" />
      <circle cx="268" cy="86" r="1.6" fill="#d8b26a" />
    </svg>
  );
}
