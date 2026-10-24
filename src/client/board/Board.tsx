import type { BoardProps } from 'boardgame.io/react';
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ROLE_LABEL,
  SKILLS,
  type Card,
  type Faction,
  type GameView,
  type Phase,
  type PlayerViewEntry,
} from '../../engine';
import { canRandomPlay, canResolveRedraw, handActions } from '../boardActions';
import { COIN_FLIGHT_MS, CRYSTAL_PULSE_MS, TURN_PULSE_MS, planAnims, type AnimSnapshot } from '../anims';
import { BudMark, ClosedEyeMark, CrystalHex, OpenEyeMark } from '../artwork';
import { CardBack, CardFace, cardLabel } from '../cards';
import { RevealStage } from './RevealStage';
import { decideRevealAnim, prefersReducedMotion } from '../revealAnim';
import { seatLayout, seatVisualOf, topRowFits, type SeatZone } from '../scene';
import { SeatCard } from './SeatCard';
import { TableScene } from './TableScene';

const PHASE_LABEL: Record<Phase, string> = {
  magic: '阶段一 · 传币并发动魔法',
  magicTargets: '阶段一 · 选择魔法目标',
  play: '阶段二 · 出牌',
  prePick: '公开前 · 指定补出者',
  redraw: '公开前换牌',
  finished: '游戏结束',
};

const FACTION_LABEL: Record<Faction, string> = {
  whiteRose: '白蔷薇阵营',
  bloodBlade: '血刃阵营',
};

/**
 * 版图区内的 mini 卡行（44×66 带卡名）。
 * 版图已移回全宽独立面板（桌心只留纹章水印），侧栏宽度充裕，全量显示、无需 cap——
 * 曾经的 cap / 「+N」徽标随桌心版图一起移除（历史见 PROGRESS §3 的压测记录）。
 */
export function ZoneChips({ cards }: { cards: Card[] }) {
  return (
    <div className="chips">
      {cards.length === 0 ? (
        <span className="dim">空</span>
      ) : (
        cards.map((c) => <CardFace key={c.id} card={c} size="mini" title={cardLabel(c)} />)
      )}
    </div>
  );
}

/** 半透明「闭眼」标记：闭眼/睁眼图标本体在 artwork.tsx（与大厅装饰资源同库管理） */

/**
 * 传币动画：硬币从上一位持币者的玩家行飞向新持币者的玩家行。
 *
 * 沿用公开结算动画已验证过的模式——用 `getBoundingClientRect` 测量起点 / 终点，
 * 再由行内 `transform` 飞行；纯展示层，不读写对局状态。
 */
function CoinFlight({ from, to }: { from: string; to: string }) {
  const [path, setPath] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const [flying, setFlying] = useState(false);

  useLayoutEffect(() => {
    const source = document.querySelector(`[data-prow="${from}"]`);
    const target = document.querySelector(`[data-prow="${to}"]`);
    if (!source || !target) return;
    const a = source.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const x = a.left + a.width / 2;
    const y = a.top + a.height / 2;
    setPath({
      x,
      y,
      dx: b.left + b.width / 2 - x,
      dy: b.top + b.height / 2 - y,
    });
    // 下一帧再加位移，保证过渡从起点起跑（同 RevealStage 的翻牌起跑处理）
    const raf = requestAnimationFrame(() => setFlying(true));
    return () => cancelAnimationFrame(raf);
  }, [from, to]);

  if (!path) return null;
  return (
    <span className="coin-flight" style={{ left: path.x, top: path.y }} aria-hidden="true">
      <span
        className={`coin-flight-body${flying ? ' flying' : ''}`}
        style={flying ? { transform: `translate(${path.dx}px, ${path.dy}px)` } : undefined}
      >
        <svg viewBox="0 0 15 15">
          <polygon points="7.5 1 1.87 10.75 13.13 10.75" />
          <polygon points="7.5 14 1.87 4.25 13.13 4.25" />
        </svg>
      </span>
    </span>
  );
}

export function Board({
  G,
  moves,
  playerID,
  ctx,
  reset,
  online,
  spectating,
  matchData,
  seatStatus,
  hotseatAllowed,
  eyeMarks,
  setEyeMarks,
}: BoardProps<GameView> & {
  online?: boolean;
  spectating?: boolean;
  /** 联机时 boardgame.io 下发的玩家元数据（已过滤凭据的数组：id / name / isConnected）；热座为 undefined */
  matchData?: { id?: string | number; name?: string; isConnected?: boolean }[];
  /**
   * 联机时房间服务器下发的座位在线状态：offline = 断线中（未开局超 1 分钟会释放座位，
   * 对局中座位保留到本局结束），ai = 断线超过 3 分钟、暂由 AI 托管。
   * 传 null / 不传时（热座或轮询还没回来）回退到 matchData 的 isConnected。
   */
  seatStatus?: { offline: string[]; ai: string[] } | null;
  /** 热座调试是否可用（构建开关 OR 开发者授权）：关闭时不显示「重开一局」 */
  hotseatAllowed: boolean;
  /**
   * 「睁眼」标注：公开与否交给玩家在桌上自行交流，界面只提供记录工具。
   * 标注按视角各记一份，只存在于本机状态（不进 GameState、也不下发）；
   * 由 App 层持有——热座切换视角会重建 boardgame.io client、Board 重新挂载，标注不随之丢失。
   */
  eyeMarks: Record<string, string[]>;
  setEyeMarks: Dispatch<SetStateAction<Record<string, string[]>>>;
}) {
  const [pickedTargets, setPickedTargets] = useState<string[]>([]);
  const [pickedCardId, setPickedCardId] = useState<string | null>(null);
  /** 观战视角：聚焦某个座位（只影响高亮——观战仅拿到公开信息，看不到任何私有内容） */
  const [watchSeat, setWatchSeat] = useState<string | null>(null);
  /** 公开结算的一幕（严格 5 秒动画）：正在放映的轮次与牌；null = 不播 */
  const [revealFilm, setRevealFilm] = useState<{ round: number; cards: Card[] } | null>(null);
  /** 结算区聚焦高亮（飞行阶段点亮，动画结束移除） */
  const [revealFocus, setRevealFocus] = useState(false);
  /** 「上一轮公开」面板：飞行动画终点 */
  const revealPanelRef = useRef<HTMLDivElement | null>(null);
  /** 已消费的结算轮次：挂载时已有的结算视为已消费（刷新 / 中途加入不重播），重开一局复位 */
  const seenRevealRef = useRef<number | null>(G.lastReveal?.round ?? null);

  /** 传币动画：硬币从 from 飞向 to（座位号），null = 不播 */
  const [coinFlight, setCoinFlight] = useState<{ from: string; to: string } | null>(null);
  /** 水晶发动：刚发动水晶的座位，null = 不播 */
  const [crystalLaunch, setCrystalLaunch] = useState<string | null>(null);
  /** 回合提醒：该脉冲的座位，null = 不播 */
  const [turnPulse, setTurnPulse] = useState<string | null>(null);
  /**
   * 席位视图：默认牌桌（三行环绕）——5–10 人均在容量内（9–10 人局两翼各 3 行、顶行收窄到 2/3 张）；
   * 紧凑列表是手动兜底视图（改造前的竖排列表）。
   */
  const [compactSeats, setCompactSeats] = useState(false);
  /**
   * 视口宽度（环绕席位的宽度门控）：顶行超出宽度预算时禁用「环绕席位」切换并自动回落
   * 紧凑列表。曾因 9–10 人局顶行 4–5 张窄屏溢出出屏而加；现顶行恒 ≤3 张，作保险保留。
   */
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  /** 上一帧快照（动效判定的基准）；挂载时为 null → 首帧不播任何动画 */
  const prevSnapRef = useRef<AnimSnapshot | null>(null);

  // 行动窗口切换时清空临时选择
  useEffect(() => {
    setPickedTargets([]);
    setPickedCardId(null);
  }, [G.round, G.phase, G.currentActor]);

  // 动效编排：比较「上一帧 → 当前帧」，决定播哪些动效（判断全在纯函数 planAnims 里，配套单测）
  useEffect(() => {
    const next: AnimSnapshot = {
      coinHolder: G.coinHolder,
      crystalsPlaced: G.crystalsPlaced,
      lastCrystalBy: G.crystalTrack.at(-1)?.player ?? null,
      currentActor: G.currentActor ?? null,
    };
    const prev = prevSnapRef.current;
    prevSnapRef.current = next;
    const plan = planAnims(prev, next, prefersReducedMotion());
    if (plan.coin) setCoinFlight(plan.coin);
    if (plan.crystal) setCrystalLaunch(plan.crystal);
    if (plan.turn) setTurnPulse(plan.turn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [G.coinHolder, G.crystalsPlaced, G.currentActor]);

  // 每项动效到时自行退场（各自独立计时，互不干扰）
  useEffect(() => {
    if (!coinFlight) return;
    const timer = window.setTimeout(() => setCoinFlight(null), COIN_FLIGHT_MS);
    return () => clearTimeout(timer);
  }, [coinFlight]);

  useEffect(() => {
    if (crystalLaunch === null) return;
    const timer = window.setTimeout(() => setCrystalLaunch(null), CRYSTAL_PULSE_MS);
    return () => clearTimeout(timer);
  }, [crystalLaunch]);

  useEffect(() => {
    if (turnPulse === null) return;
    const timer = window.setTimeout(() => setTurnPulse(null), TURN_PULSE_MS);
    return () => clearTimeout(timer);
  }, [turnPulse]);

  // 观察到「新」的公开结算时放映一幕动画（同一轮只播一次；时序见 RevealStage）
  useEffect(() => {
    const reveal = G.lastReveal;
    const { seen, play } = decideRevealAnim(
      seenRevealRef.current,
      reveal ? { round: reveal.round, cards: reveal.cards } : null,
      prefersReducedMotion(),
    );
    if (seen === seenRevealRef.current) return;
    seenRevealRef.current = seen;
    if (!play || !reveal) return;
    setRevealFocus(false);
    setRevealFilm({ round: reveal.round, cards: reveal.cards });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [G.lastReveal?.round, G.lastReveal?.cards.length]);

  const me: PlayerViewEntry | undefined = G.players.find((p) => p.id === playerID);
  const isMyTurn = G.currentActor === playerID;
  /** 手牌区在出牌阶段的按钮（条件判断见 boardActions.ts，配套单测） */
  const handOps = handActions(G, playerID, pickedCardId);
  const gameover = ctx?.gameover as { winner?: Faction; reason?: string } | undefined;
  /**
   * 联机时玩家名显示大厅 join 时填的昵称：boardgame.io 下发的 matchData 是数组
   * （元素含 id / name / isConnected，见 master 的 filterMatchData）；热座没有 matchData，回退到引擎内的名字。
   */
  const matchPlayerOf = (id: string) =>
    (matchData ?? []).find((player) => String(player.id) === id);
  const nameOf = (id: string) =>
    matchPlayerOf(id)?.name ?? G.players.find((p) => p.id === id)?.name ?? id;
  /**
   * 该座位是否断线中。联机优先用房间服务器的真值（seatStatus）：AI 托管中的座位在服务器看来
   * 断线、但 matchData 会因 AI 提交动作的短暂连接闪现「在线」，以服务器为准更稳定；
   * 服务器数据还没回来（或热座）时回退到 matchData.isConnected。
   */
  const isOffline = (id: string) =>
    seatStatus
      ? seatStatus.offline.includes(id) || seatStatus.ai.includes(id)
      : matchPlayerOf(id)?.isConnected === false;
  /** 该座位是否已由服务器 AI 暂时托管（断线超 3 分钟；出牌跳过、技能随机选人） */
  const isAi = (id: string) => (seatStatus ? seatStatus.ai.includes(id) : false);
  /** 日志里的「玩家 N」也替换成昵称 */
  const withNicknames = (line: string) =>
    line.replace(/玩家 (\d+)/g, (whole, n: string) => matchPlayerOf(String(Number(n) - 1))?.name ?? whole);
  const winner = gameover?.winner ?? G.winner;

  const lastReveal = G.lastReveal;
  /** 卡牌 id → 出牌者；匿名公开时 byPlayer 为空，天然查不到出牌者 */
  const revealOwners = new Map(
    Object.entries(lastReveal?.byPlayer ?? {}).map(([id, card]) => [card.id, id]),
  );
  /** 本轮发动的水晶与技能；尚未发动时 crystalTrack 还没有这一轮的条目（技能从 G.skills 派生） */
  const roundCrystal = G.crystalTrack.at(G.round - 1);
  const roundSkillId = roundCrystal ? G.skills[roundCrystal.value] : undefined;
  const roundSkill = roundSkillId ? SKILLS[roundSkillId] : null;
  /** 换牌挂起时阶段行改用换牌表述（此时仍是 play 阶段，但动作不是出牌） */
  const phaseLabel = G.pendingRedraw ? '换牌阶段（10 号）' : PHASE_LABEL[G.phase];

  const nightEntry = (G.knowledge ?? []).find((k) => k.kind === 'nightGroup');
  const myNightGroup = nightEntry && nightEntry.kind === 'nightGroup' ? nightEntry.players : [];
  /** 睁眼玩家（白蔷薇/司教/双刃/巨刃）：夜间情报只有他们持有，眼睛列由系统直接标注 */
  const isNightViewer = myNightGroup.length > 0;

  /** 当前视角对某位玩家的「睁眼」标注（他人视角互不可见） */
  const isEyeMarked = (id: string) => (eyeMarks[playerID ?? ''] ?? []).includes(id);

  function toggleEyeMark(id: string) {
    const key = playerID ?? '';
    setEyeMarks((prev) => {
      const mine = prev[key] ?? [];
      return { ...prev, [key]: mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id] };
    });
  }

  /** 自己那枚水晶对应的技能：编号只是指针，玩家看不到技能时就无从决策（技能从 G.skills 派生） */
  const mySkillId = me?.crystal === undefined ? undefined : G.skills[me.crystal];
  const mySkill = mySkillId ? SKILLS[mySkillId] : null;

  function toggleTarget(id: string) {
    const need = G.pendingMagic?.needTargets ?? 1;
    const next = pickedTargets.includes(id)
      ? pickedTargets.filter((x) => x !== id)
      : [...pickedTargets, id];
    if (next.length === need) {
      moves.resolveMagicTargets(next);
      setPickedTargets([]);
    } else {
      setPickedTargets(next);
    }
  }

  // 动态目标池：由引擎按本局实况解析并下发（含扩充技能），UI 只允许从池内选人
  const targetPool = G.pendingMagic?.pool ?? [];
  const candidates = G.players.filter((p) => targetPool.includes(p.id));
  /** 扩充 6 号（公开前补出）：可选对象 = 未出牌且有手牌者 */
  const prePickPool = G.phase === 'prePick' ? (G.modifiers.pendingPick?.pool ?? []) : [];

  const redrawCandidates = G.players.filter(
    (p) => p.id !== playerID && p.played && p.handCount > 0,
  );

  /**
   * 席位分布（共享纯函数 `scene.seatLayout`）：自己恒独占底行（底行整块留给「自己 + 手牌空间」），
   * 其余按「自己起顺时针」填入 左翼 → 顶行（左→右） → 右翼（7–8 人局两翼各 2 张、5–6 人局各 1 张）。
   * 「自己」的取值：观战视角聚焦的座位优先（观战切到某座位时桌也跟着转），
   * 否则就是本人的座位；都没有（观战全局）时按座位 1 处理。
   */
  const focusSeat =
    watchSeat !== null ? Number(watchSeat) : playerID === null ? null : Number(playerID);
  const seatSlots = seatLayout(focusSeat, G.players.length);
  const slotOf = (seat: string) => seatSlots.find((slot) => slot.id === seat);
  /** 某一分区的席位（卡上从左到右的顺序；紧凑列表不用分区、按座位序竖排） */
  const zoneSeats = (zone: SeatZone) =>
    G.players
      .filter((p) => slotOf(p.id)?.zone === zone)
      .sort((a, b) => (slotOf(a.id)?.col ?? 0) - (slotOf(b.id)?.col ?? 0));

  /** 环绕席位放不放得下：顶行张数 × 席位卡宽 + 间距 ≤ 视口宽度（纯函数 `scene.topRowFits`） */
  const surroundFits = topRowFits(viewportWidth, seatSlots.filter((s) => s.zone === 'top').length);

  // 放不下时自动回落紧凑列表（转屏 / 缩放窗口让环绕溢出时兜底）
  useEffect(() => {
    if (!surroundFits) setCompactSeats(true);
  }, [surroundFits]);

  /**
   * 桌心版图（2026-10-17 改版）：版图移回全宽独立面板（紧凑列表沿用同一渲染），
   * 环绕模式的桌心只留纹章水印——不再受席位环的宽度约束。
   */
  function renderBoard() {
    return (
      <div className="board-grid">
        <div className="board-col">
          <h3 className="col-head">献祭区</h3>
          <div className="zone">
            <h3>
              白蔷薇{' '}
              <em className="rose-count">
                ✿ {G.zones.whiteRose.length}/{G.cardTotals.whiteRose}
              </em>
            </h3>
            <ZoneChips cards={G.zones.whiteRose} />
          </div>
          <div className="zone">
            <h3>
              普通花苞{' '}
              <em className="bud">
                <BudMark /> {G.sacrificeBuds}/{G.thresholds.sacrifice}
              </em>
            </h3>
            <ZoneChips cards={G.zones.sacrifice} />
          </div>
        </div>
        <div className="board-col">
          <h3 className="col-head">弃牌区</h3>
          <div className="zone board-center">
            <span className="dim">
              {G.zones.ghostCount > 0 ? `幽魂 ${G.zones.ghostCount}` : '无'}
            </span>
          </div>
        </div>
        <div className="board-col">
          <h3 className="col-head">血刃区</h3>
          <div className="zone">
            <h3>
              血刃 <em className="blade">⚔ {G.zones.blade.length}/{G.cardTotals.blade}</em>
            </h3>
            <ZoneChips cards={G.zones.blade} />
          </div>
          <div className="zone">
            <h3>
              死亡花苞{' '}
              <em className="bud bud-dead">
                <BudMark dead /> {G.deathBuds}/{G.thresholds.death}
              </em>
            </h3>
            <ZoneChips cards={G.zones.death} />
          </div>
        </div>
      </div>
    );
  }

  /** 单张席位卡：分区与显示内容都算好，交给外层 TableScene 按三行排布（紧凑列表按座位序竖排） */
  function renderSeatCard(p: PlayerViewEntry) {
    /**
     * 行末标签、水晶编号与持币硬币统一由共享层 `scene.seatVisualOf` 给出
     * （口径与 Board 原实现逐字对齐，由 `scene.test.ts` 锁死，供步骤 4 的席位卡复用）。
     */
    const visual = seatVisualOf(G, p, { offline: isOffline(p.id), ai: isAi(p.id) });

    const selectable =
      (G.phase === 'magic' && isMyTurn && !p.crystalPlaced) ||
      (G.phase === 'magicTargets' && isMyTurn && candidates.some((c) => c.id === p.id)) ||
      (G.phase === 'prePick' && isMyTurn && prePickPool.includes(p.id)) ||
      (G.phase === 'redraw' && isMyTurn && redrawCandidates.some((c) => c.id === p.id));

    // 睁眼玩家视角：整列由系统标注（组内=睁眼、组外=未睁眼），不允许修改；
    // 非睁眼玩家视角：默认半透明「闭眼」，点击在「闭眼 ⇄ 睁眼」之间切换自己的判断。
    const eyeOpen = isNightViewer ? myNightGroup.includes(p.id) : isEyeMarked(p.id);
    const eyeClass = `eye-slot${eyeOpen ? ' marked' : ''}`;
    const eyeTitle = isNightViewer
      ? eyeOpen
        ? '夜间睁眼的玩家（系统标注，不可修改）'
        : '夜间未睁眼的玩家（系统标注，不可修改）'
      : eyeOpen
        ? '取消「睁眼」标注'
        : '标注为「睁眼」玩家（仅记录在你的视角，不会公开）';

    // 标注槽位放在行按钮之外：行按钮常处于禁用态（禁用的按钮不会派发点击），
    // 而非睁眼玩家的标注在任何阶段都应该能点。
    const eye = spectating ? (
      // 观战席看不到睁眼 / 闭眼信息：保留空槽位对齐
      <span className="eye-slot" aria-hidden="true" />
    ) : isNightViewer ? (
      <span className={`${eyeClass} locked`} title={eyeTitle}>
        {eyeOpen ? <OpenEyeMark /> : <ClosedEyeMark />}
      </span>
    ) : (
      <button
        className={eyeClass}
        aria-pressed={eyeOpen}
        title={eyeTitle}
        onClick={() => toggleEyeMark(p.id)}
      >
        {eyeOpen ? <OpenEyeMark /> : <ClosedEyeMark />}
      </button>
    );

    return (
      <SeatCard
        key={p.id}
        seat={p.id}
        name={nameOf(p.id)}
        visual={visual}
        isSelf={p.id === playerID}
        picked={pickedTargets.includes(p.id)}
        focused={watchSeat === p.id}
        offline={isOffline(p.id)}
        pulse={turnPulse === p.id}
        acting={G.currentActor === p.id}
        selectable={selectable}
        onAct={() => {
          if (G.phase === 'magic') moves.passCoin(p.id);
          else if (G.phase === 'magicTargets') toggleTarget(p.id);
          else if (G.phase === 'prePick') moves.pickPreShuffleTarget(p.id);
          else if (G.phase === 'redraw') moves.resolveRedraw(p.id);
        }}
        eye={eye}
      />
    );
  }

  /**
   * 当前正在进行的步骤。
   * 原先这些提示埋在玩家区底部的操作栏里，等待类文案不够醒目，
   * 因此独立成「游戏进程」面板，紧跟牌桌下方。
   */
  function stepText(): string {
    if (G.phase === 'finished') return '对局已结束。';
    if (G.phase === 'magic') {
      return isMyTurn
        ? '轮到你：把硬币交给一名水晶尚未放上版图的玩家（可以交给自己）。'
        : `等待 ${nameOf(G.coinHolder)} 交出硬币…`;
    }
    if (G.phase === 'magicTargets' && G.pendingMagic) {
      const magic = G.pendingMagic;
      if (magic.needTargets === 0) {
        return isMyTurn
          ? `轮到你：为【${magic.name}】选择目标——当前没有可选目标，确认即可。`
          : `等待 ${nameOf(magic.chooser)} 为【${magic.name}】指定目标…`;
      }
      return isMyTurn
        ? `轮到你：为【${magic.name}】选择 ${magic.needTargets} 名目标（已选 ${pickedTargets.length}）。`
        : `等待 ${nameOf(magic.chooser)} 为【${magic.name}】指定目标…`;
    }
    if (G.phase === 'play') {
      if (G.pendingRedraw !== null) {
        return isMyTurn
          ? '轮到你：换牌——从手牌中选一张替换你已打出的牌，被替换的牌收回你手中。'
          : `等待 ${nameOf(G.pendingRedraw)} 换牌…`;
      }
      if (!isMyTurn) return `等待 ${nameOf(G.currentActor ?? '')} 出牌或跳过…`;
      if (G.modifiers.mustPass.includes(playerID ?? '')) return '轮到你：本回合必须跳过。';
      if (G.modifiers.randomPlay) {
        return '轮到你：本回合出牌由系统随机抽取——点击「随机出牌」；也可以选择跳过。';
      }
      if (G.modifiers.bishopMustPlay && me?.role === 'bishop' && (me.handCount ?? 0) > 0) {
        return '轮到你：本轮（司教持有手牌）必须出牌——点击你的手牌选中，再确认出牌。';
      }
      return G.modifiers.mustPlay.includes(playerID ?? '')
        ? '轮到你：本回合必须出牌——点击你的手牌选中，再确认出牌。'
        : '轮到你：点击你的手牌选中，再确认出牌；也可以选择跳过。';
    }
    if (G.phase === 'prePick') {
      const pick = G.modifiers.pendingPick;
      return isMyTurn
        ? '轮到你：指定一名尚未出牌的玩家，在公开前随机补出一张牌（匿名混入）。'
        : `等待 ${nameOf(pick?.chooser ?? '')} 指定补出者…`;
    }
    if (G.phase === 'redraw') {
      return isMyTurn
        ? '轮到你：可以指定一名本轮已出牌且仍有手牌的玩家，由该玩家自己换牌；也可以放弃。'
        : `等待 ${nameOf(G.modifiers.redrawOption ?? '')} 决定是否换牌…`;
    }
    return '';
  }

  /**
   * 阶段专属动作按钮（只返回按钮本身，并入手牌区的常驻操作行）：
   * 换牌阶段的「放弃换牌」、技能目标池为空时的确认。
   * 返回 null 表示当前没有阶段专属动作，操作行走常规出牌按钮。
   */
  function phaseActionButtons() {
    // 扩充技能可能出现「没有可选目标」（如 5 号技能目标池为空）：确认后按空集合结算
    if (G.phase === 'magicTargets' && isMyTurn && (G.pendingMagic?.needTargets ?? 1) === 0) {
      return (
        <button className="btn primary" onClick={() => moves.resolveMagicTargets([])}>
          没有可选目标，确认
        </button>
      );
    }
    if (!canResolveRedraw(G, playerID)) return null;
    return (
      <button className="btn" onClick={() => moves.resolveRedraw()}>
        放弃换牌
      </button>
    );
  }

  /**
   * 观战占位：手牌不公开，按底行（聚焦座位）的公开手牌数渲染卡背（最多 4 张，更多折成「+N」）。
   * 水晶同理不公开——席位卡只在「已放上版图」后才显示编号，这里不再另作处理。
   */
  function renderHandBacks() {
    const bottomSeat = zoneSeats('bottom')[0];
    const count = bottomSeat?.handCount ?? 0;
    const shown = Math.min(count, 4);
    return (
      <div className="hand">
        {Array.from({ length: shown }, (_, i) => (
          <CardBack key={i} />
        ))}
        {count > shown && <span className="dim">+{count - shown}</span>}
      </div>
    );
  }

  /**
   * 手牌空间（方案 §5.1：底行＝当前视角玩家独享）：身份行 + 技能说明 + 手牌卡面 + 操作按钮。
   * 操作按钮行**常驻**——未轮到自己时「跳过」禁用占位、阶段专属按钮原位替换，
   * 保证区域高度不随回合切换跳动。
   *
   * 一份内容两处挂载：
   *   - `withHeading = false`：牌桌底行自区的右侧（环绕席位模式的默认位置）；
   *   - `withHeading = true`：紧凑列表（手动兜底视图）下没有牌桌，
   *     仍在原位以「你的手牌」面板呈现。
   * 观战（`me` 为空）：面板形态整体不渲染（与原行为一致）；牌桌自区改用卡背占位。
   */
  function renderHandArea(withHeading: boolean) {
    if (!me?.role) {
      if (withHeading) return null;
      return (
        <div className="self-hand spectator">
          {renderHandBacks()}
          <p className="dim">观战视角 · 手牌与水晶不公开</p>
        </div>
      );
    }

    const body = (
      <>
        <p className="identity">
          角色 <strong>{ROLE_LABEL[me.role]}</strong> · {FACTION_LABEL[me.faction!]} · 水晶{' '}
          <strong>{me.crystal}</strong>
        </p>
        {mySkill && (
          <p className="skill-note">
            <strong>
              水晶 {me.crystal} · {mySkill.name}
            </strong>
            <span className="dim">{mySkill.text}</span>
          </p>
        )}
        <div className="hand">
          {(me.hand ?? []).map((c) => {
            const canHandAct =
              G.phase === 'play' && isMyTurn && !G.modifiers.mustPass.includes(playerID ?? '');
            // 3 号扩充：随机出牌轮不能选牌（牌由引擎抽）；9 号扩充：幽魂不可出
            const ghostLocked = G.modifiers.noGhost && c.kind === 'ghost';
            const playable = canHandAct && !G.modifiers.randomPlay && !ghostLocked;
            return (
              <button
                key={c.id}
                className={`card${pickedCardId === c.id ? ' selected' : ''}`}
                disabled={!playable}
                title={ghostLocked ? '本轮不能打出幽魂牌' : undefined}
                onClick={() =>
                  setPickedCardId((prev) => {
                    if (prev === c.id) return prev;
                    return c.id;
                  })
                }
              >
                <CardFace card={c} title={ghostLocked ? '本轮不能打出幽魂牌' : undefined} />
              </button>
            );
          })}
        </div>
        {G.modifiers.bishopMustPlay && me.role === 'bishop' && (me.handCount ?? 0) > 0 && (
          <p className="skill-note">
            <span className="dim">本轮司教若持有手牌必须出牌（规则公开，身份不公开）</span>
          </p>
        )}
        {/* 操作行常驻（方案 §5.1）：轮不到自己 / 非出牌阶段时按钮禁用占位，
            行高不随回合跳动；阶段专属按钮（放弃换牌等）在同一行内替换常规出牌按钮 */}
        <div className="actions">
          {phaseActionButtons() ?? (
            <>
              {handOps?.canGoLast && (
                <button className="btn" onClick={() => moves.chooseGoLast()}>
                  我要最后行动
                </button>
              )}
              {canRandomPlay(G, playerID) && (
                <button className="btn primary" onClick={() => moves.playRandom()}>
                  随机出牌
                </button>
              )}
              {handOps?.canConfirm && (
                <>
                  <button
                    className="btn primary"
                    onClick={() => {
                      moves.playCard(pickedCardId!);
                      setPickedCardId(null);
                    }}
                  >
                    {G.pendingRedraw === playerID ? '确认替换' : '确认出这张牌'}
                  </button>
                  <button className="btn" onClick={() => setPickedCardId(null)}>
                    取消
                  </button>
                </>
              )}
              <button
                className="btn"
                disabled={!handOps?.canSkip}
                title={handOps ? undefined : '未到你的出牌回合'}
                onClick={() => moves.passTurn()}
              >
                跳过
              </button>
            </>
          )}
        </div>
      </>
    );

    return withHeading ? (
      <div className="panel">
        <h2>你的手牌</h2>
        {body}
      </div>
    ) : (
      <div className="self-hand">{body}</div>
    );
  }

  function renderKnowledge() {
    const knowledge = G.knowledge ?? [];
    const others = knowledge.filter((k) => k.kind !== 'nightGroup');
    if (knowledge.length === 0) return null;

    return (
      <div className="panel">
        <h2>你的私密情报</h2>
        <ul className="knowledge">
          {myNightGroup.length > 0 && (
            <li>
              夜里睁眼的同组玩家：{myNightGroup.map(nameOf).join('、')}
              <span className="dim">（只看到人，不知道谁是队友）</span>
            </li>
          )}
          {others.map((k, i) => {
            if (k.kind === 'scoutedRoles') {
              return (
                <li key={i}>
                  暗刃侦查：{k.players.map(nameOf).join('、')}
                  <span className="dim">（只知道名单，无法区分具体身份）</span>
                </li>
              );
            }
            if (k.kind === 'peekedCard') {
              return (
                <li key={i}>
                  窥牌：{nameOf(k.target)} 手中有一张「{cardLabel(k.card)}」
                </li>
              );
            }
            return null;
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="board">
      {winner && (
        <div className={`banner ${winner}`}>
          <strong>{FACTION_LABEL[winner]} 胜利</strong>
          <span>{G.winReason ?? gameover?.reason}</span>
        </div>
      )}

      {/* 版图（出牌公式区域）统一在最上：全宽独立面板，两种模式顺序一致（牌桌 / 列表在其下） */}
      <div className="panel">
        <h2>版图</h2>
        {renderBoard()}
      </div>

      {/* 牌桌置顶（步骤 4 · A2）：桌面 + 席位环绕 + 桌心纹章水印；视图切换器保留在桌上方 */}
      <div className="panel-head">
        <h2>牌桌{spectating ? ' · 观战' : ''}</h2>
        {spectating && (
          <span className="seats">
            <span className="dim">观战视角：</span>
            <button
              className={`btn small${watchSeat === null ? ' primary' : ''}`}
              onClick={() => setWatchSeat(null)}
            >
              全局
            </button>
            {G.players.map((p) => (
              <button
                key={p.id}
                className={`btn small${watchSeat === p.id ? ' primary' : ''}`}
                onClick={() => setWatchSeat(p.id)}
              >
                座位 {p.seat + 1}
              </button>
            ))}
          </span>
        )}
        {/* 紧凑列表为手动兜底视图（改造前的竖排列表）；
            宽度门控：视口放不下顶行时禁用环绕切换（防顶行溢出出屏） */}
        <button
          className="btn small"
          disabled={!surroundFits}
          title={surroundFits ? undefined : '当前屏幕宽度放不下环绕席位的顶行，请加宽窗口或旋转横屏'}
          onClick={() => setCompactSeats((prev) => !prev)}
        >
          {compactSeats ? '环绕席位' : '紧凑列表'}
        </button>
      </div>
      {compactSeats ? (
        <div className="players">{G.players.map((p) => renderSeatCard(p))}</div>
      ) : (
        /* 底行 = 当前视角玩家独享：左＝自己的席位卡，右＝手牌空间（含阶段动作按钮） */
        <TableScene
          wingRows={G.players.length >= 9 ? 3 : 2}
          top={<>{zoneSeats('top').map((p) => renderSeatCard(p))}</>}
          left={<>{zoneSeats('left').map((p) => renderSeatCard(p))}</>}
          right={<>{zoneSeats('right').map((p) => renderSeatCard(p))}</>}
          bottom={
            <>
              <div className="self-seat">{zoneSeats('bottom').map((p) => renderSeatCard(p))}</div>
              {renderHandArea(false)}
            </>
          }
        />
      )}

      <div className={`panel progress${isMyTurn ? ' me' : ''}`}>
        <div className="panel-head">
          <h2>游戏进程</h2>
          {/* 联机模式下的重开由房主在顶栏操作（多人模式下本地 reset 无效）；热座未解锁时不显示 */}
          {!online && hotseatAllowed && (
            <button
              className="btn small"
              onClick={() => {
                setEyeMarks({}); // 新一局角色重新洗牌，旧标注不再有意义
                reset();
              }}
            >
              重开一局
            </button>
          )}
        </div>
        <p className="step">{stepText()}</p>
        <p className="meta dim">
          第 {G.round} 轮 · {phaseLabel}
          {G.modifiers.laps === 2 ? `（出牌第 ${G.lap}/2 圈）` : ''} · 持币：{nameOf(G.coinHolder)}
        </p>
        <h3 className="col-head">轮次</h3>
        <div className="crystal-track">
          {Array.from({ length: G.players.length }, (_, i) => {
            const entry = G.crystalTrack[i];
            // 刚发动的那一枚（末条）做一次高亮脉冲，解释「本轮的技能从哪来」
            const launching = crystalLaunch !== null && i === G.crystalTrack.length - 1;
            if (!entry) {
              return (
                <span key={i} className="track-hex" title={`第 ${i + 1} 轮（尚未发动）`}>
                  <CrystalHex />
                  <span className="track-hex-body" />
                </span>
              );
            }
            return (
              <span
                key={i}
                className={`track-hex filled${launching ? ' launching' : ''}`}
                title={`第 ${i + 1} 轮 · ${nameOf(entry.player)} 发动水晶 ${entry.value}`}
              >
                <CrystalHex placed />
                <span className="track-hex-body">{entry.value}</span>
              </span>
            );
          })}
        </div>
        {roundSkill && roundCrystal && (
          <p className={`round-note${crystalLaunch !== null ? ' launching' : ''}`}>
            <strong>
              本轮水晶 {roundCrystal.value} ·【{roundSkill.name}】
            </strong>
            <span className="dim">{roundSkill.text}</span>
          </p>
        )}
      </div>

      {lastReveal && lastReveal.cards.length > 0 && (
        <div ref={revealPanelRef} className={`panel${revealFocus ? ' reveal-focus' : ''}`}>
          <h2>上一轮公开</h2>
          <p className="dim">
            第 {lastReveal.round} 轮 ·{' '}
            {lastReveal.attributed ? '按出牌顺序公开，已标注出牌者' : '洗混后匿名公开'}
          </p>
          <div className="chips">
            {lastReveal.cards.map((c) => {
              const owner = revealOwners.get(c.id);
              return (
                <span key={c.id} className="reveal-item">
                  <CardFace card={c} size="reveal" />
                  {owner && <em className="reveal-owner">{nameOf(owner)}</em>}
                </span>
              );
            })}
          </div>
          <div className="play-status">
            <p className="play-status-label">
              出牌情况（自持币者 {nameOf(lastReveal.coinHolder)} 起顺时针）
            </p>
            <p className="play-status-list">
              {lastReveal.playStatus.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && '、'}
                  {nameOf(s.id)}{' '}
                  <em className={s.played ? 'play-status-played' : 'play-status-passed'}>
                    {s.played ? '已出牌' : '跳过'}
                  </em>
                </span>
              ))}
            </p>
          </div>
        </div>
      )}

      {/* 环绕席位模式下，手牌空间在牌桌下方的自区面板里（`.self-hand`）；这里只兜底紧凑列表模式 */}
      {compactSeats && renderHandArea(true)}

      {renderKnowledge()}

      <div className="panel">
        <h2>日志</h2>
        <ol className="log">
          {G.log.slice(-10).map((line, i) => (
            <li key={i}>{withNicknames(line)}</li>
          ))}
        </ol>
      </div>

      {coinFlight && <CoinFlight from={coinFlight.from} to={coinFlight.to} />}

      {revealFilm && (
        <RevealStage
          key={revealFilm.round}
          round={revealFilm.round}
          cards={revealFilm.cards}
          targetRef={revealPanelRef}
          onFlyStart={() => setRevealFocus(true)}
          onDone={() => {
            setRevealFilm(null);
            setRevealFocus(false);
          }}
        />
      )}
    </div>
  );
}
