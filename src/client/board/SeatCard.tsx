import { type CSSProperties, type ReactNode } from 'react';
import { avatarColor } from '../avatar';
import type { SeatVisual } from '../scene';

/**
 * 席位卡（步骤 4 · A3）：环上的一个座位，或紧凑列表里的一行。
 *
 * 这是**原「玩家行」的等价搬移**——`.player-line` / `.player-row` / `data-prow` 以及
 * `me` / `picked` / `focused` / `offline` / `turn-pulse` 这些类名一律保留，因为：
 *   1. `CoinFlight` 靠 `[data-prow]` 测量硬币飞行的起点与终点；
 *   2. 回合脉冲（`turn-pulse`）与水晶轨道高亮等动效的 CSS 咬死这些类名；
 *   3. 行按钮本身承担阶段动作（传币 / 选魔法目标 / 公开前补出 / 换牌）。
 *
 * 显示内容全部取自共享层 `scene.seatVisualOf`（单一来源，不再与 Board 各写一套）；
 * 「是不是自己」仍按 `playerID` 判断（观战 / 热座两条路径下都与视图的 `viewer` 等价，
 * 但用 playerID 更直白）。席位在环上的位置由 Board 算好后经 `slotStyle` 传入。
 */
export function SeatCard({
  seat,
  name,
  visual,
  slotStyle,
  isSelf,
  picked,
  focused,
  offline,
  pulse,
  selectable,
  onAct,
  eye,
}: {
  /** 座位号（0 起，= boardgame.io 的 playerID） */
  seat: string;
  /** 显示名（联机为昵称，热座回退引擎名，由 Board 解析后传入） */
  name: string;
  visual: SeatVisual;
  /** 环上定位（归一化坐标 → 百分比）；紧凑列表模式下不生效（父级是静态流） */
  slotStyle: CSSProperties;
  isSelf: boolean;
  /** 已被选为魔法目标 */
  picked: boolean;
  /** 观战视角聚焦的座位 */
  focused: boolean;
  /** 断线（含 AI 托管）：整卡变灰 */
  offline: boolean;
  /** 本轮行动者：播放一次金色脉冲 */
  pulse: boolean;
  /** 当前阶段是否可点（决定行按钮是否禁用） */
  selectable: boolean;
  onAct: () => void;
  /** 眼睛槽：由 Board 决定是「系统标注（不可点）」还是「本机标注（可点）」 */
  eye: ReactNode;
}) {
  const rowClass = `player-row${isSelf ? ' me' : ''}${picked ? ' picked' : ''}${
    focused ? ' focused' : ''
  }${offline ? ' offline' : ''}${pulse ? ' turn-pulse' : ''}`;

  return (
    <div className="player-line" data-prow={seat} data-slot={seat} style={slotStyle}>
      {/* 标注槽位放在行按钮之外：行按钮常处于禁用态（禁用的按钮不会派发点击），
          而非睁眼玩家的标注在任何阶段都应该能点。 */}
      {eye}
      <button className={rowClass} disabled={!selectable} onClick={onAct}>
        <span className="seat">{visual.seatLabel}</span>
        <span className="avatar small" style={{ background: avatarColor(name) }}>
          {name.slice(0, 1)}
        </span>
        <span className="pname" title={name}>
          {name}
        </span>
        {/* 固定宽度的「（你）」槽位：保证手牌框与水晶纵向对齐 */}
        <span className="self-slot">{isSelf ? '（你）' : ''}</span>
        <span
          className={`hand-box${visual.handCount === 0 ? ' empty' : ''}`}
          title={`手牌 ${visual.handCount} 张`}
        >
          {visual.handCount}
        </span>
        <span
          className={`crystal${visual.crystal.placed ? ' placed' : ''}`}
          title={
            visual.crystal.placed
              ? `水晶 ${visual.crystal.label} 已放上版图`
              : isSelf
                ? `你的水晶 ${visual.crystal.label}（尚未放出）`
                : '水晶尚未放出'
          }
        >
          <span className="crystal-body">{visual.crystal.label}</span>
        </span>
        {(visual.coin || visual.tokens.length > 0) && (
          <span className="tags">
            {visual.coin && (
              <em className="coin" title="持币者（本轮由他传币）" aria-label="持币者">
                {/* 空心六角星：两个内接等边三角形的描边 */}
                <svg viewBox="0 0 15 15" aria-hidden="true">
                  <polygon points="7.5 1 1.87 10.75 13.13 10.75" />
                  <polygon points="7.5 14 1.87 4.25 13.13 4.25" />
                </svg>
              </em>
            )}
            {visual.tokens.map((token) => (
              <em key={token.text} className={`tag${token.gray ? ' gray' : ''}`}>
                {token.text}
              </em>
            ))}
          </span>
        )}
      </button>
    </div>
  );
}
