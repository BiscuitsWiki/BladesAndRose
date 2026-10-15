import { useEffect, useRef, useState } from 'react';
import type { Card } from '../../engine';
import { CardFace } from '../cards';
import { REVEAL_FLIP_MS, REVEAL_TOTAL_MS } from '../revealAnim';

interface FlyTarget {
  dx: number;
  dy: number;
  scale: number;
}

/**
 * 公开结算的一幕（严格 5 秒、不可点击跳过）：
 *  - 前 3 秒：弹窗内所有公开牌同时从背面缓缓翻开；
 *  - 后 2 秒：牌缩小飞向「上一轮公开」结算区，并高亮该区域。
 * 纯展示层：不读写对局状态、不影响联机同步；prefers-reduced-motion 由触发处直接跳过。
 */
export function RevealStage({
  round,
  cards,
  targetRef,
  onFlyStart,
  onDone,
}: {
  round: number;
  cards: Card[];
  /** 「上一轮公开」结算面板（飞行终点） */
  targetRef: React.RefObject<HTMLDivElement | null>;
  /** 进入飞行阶段（外层点亮结算区） */
  onFlyStart: () => void;
  /** 5 秒结束 */
  onDone: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [flying, setFlying] = useState(false);
  const [targets, setTargets] = useState<FlyTarget[]>([]);
  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const timers: number[] = [];
    // 先把结算区滚进视野（遮罩遮住了这次跳转），再锁页面滚动，避免飞行期间坐标错位
    const prevOverflow = document.body.style.overflow;
    targetRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
    document.body.style.overflow = 'hidden';

    /** 逐张测量「弹窗里的牌 → 结算区对应位置」的位移与缩放 */
    function measureTargets(): FlyTarget[] | null {
      const grid = gridRef.current;
      const target = targetRef.current;
      const els = grid ? Array.from(grid.querySelectorAll<HTMLElement>('.reveal-anim-card')) : [];
      const slots = target ? Array.from(target.querySelectorAll<HTMLElement>('.reveal-item')) : [];
      if (els.length === 0 || els.length !== slots.length) return null;
      return els.map((el, i) => {
        const a = el.getBoundingClientRect();
        const b = slots[i]!.getBoundingClientRect();
        return {
          dx: b.left + b.width / 2 - (a.left + a.width / 2),
          dy: b.top + b.height / 2 - (a.top + a.height / 2),
          scale: Math.min(b.width / a.width, 1),
        };
      });
    }

    function startFly() {
      const measured = measureTargets();
      setFlying(true);
      if (measured) setTargets(measured); // 测量不到目标就原地淡出，保持 5 秒节奏
      onFlyStart();
    }

    raf = requestAnimationFrame(() => {
      setFlipped(true); // 下一帧再加类，保证翻牌过渡从背面起跑
      timers.push(window.setTimeout(startFly, REVEAL_FLIP_MS));
      timers.push(window.setTimeout(onDone, REVEAL_TOTAL_MS));
    });

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      document.body.style.overflow = prevOverflow;
    };
    // 每轮一个新实例（外层以 key=round 重挂），effect 只跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`reveal-film${flying ? ' flying' : ''}`} aria-hidden="true">
      <div className="reveal-stage">
        <h2 className="reveal-stage-head">第 {round} 轮 · 公开结算</h2>
        <div className="reveal-grid" ref={gridRef}>
          {cards.map((card, i) => (
            <div
              key={card.id}
              className={`reveal-anim-card${flipped ? ' flipped' : ''}`}
              style={
                flying && targets[i]
                  ? {
                      transform: `translate(${targets[i]!.dx}px, ${targets[i]!.dy}px) scale(${targets[i]!.scale})`,
                    }
                  : undefined
              }
            >
              <div className="reveal-anim-inner">
                <span className="reveal-anim-face reveal-anim-back" />
                <span className="reveal-anim-face reveal-anim-front">
                  <CardFace card={card} size="fill" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}