/**
 * 场景纯函数 —— 表现层共享层（docs/UI-OVERHAUL-PLAN.md §6.3）。
 *
 * 分工：「决定做什么」是这里的纯函数，「怎么画」由各端自己写（Web 端 DOM / CSS / SVG，
 * 小程序端 WXSS / Canvas 2D）。因此本文件**不依赖 React / DOM / window**，只 import engine 的
 * 常量与 type-only 类型，返回值全部是可序列化的原始值——小程序端（阶段三）要原样复用这一份。
 *
 * 分区约定（`seatLayout` 的 zone / col）：牌桌排成「顶行 / 中间（左翼·桌心·右翼）/ 底行」三段，
 * `zone` 给出席位落在哪一段，`col` 给出段内的**顺时针序号**（端上按 col 升序摆放即可）。
 * 端上把同一段的席位横排/纵排即可，不再做绝对定位——席位卡宽度随视口收缩也不会互相挤压。
 */
import {
  FACTION_OF,
  ROLE_LABEL,
  type Card,
  type Faction,
  type GameView,
  type PlayerViewEntry,
} from '../engine';

/** 席位所在的桌区分区：顶行（横排 2–5）、左右两翼（各 0–2）、底行（恒 1：当前视角本人） */
export type SeatZone = 'top' | 'left' | 'right' | 'bottom';

/** 席位在牌桌上的位置与分区内次序 */
export interface SeatSlot {
  /** 座位号（0 起，与 boardgame.io 的 playerID 一致） */
  id: string;
  /** 席位所在分区 */
  zone: SeatZone;
  /**
   * 分区内的**顺时针序号**（0 = 顺时针最先；端上按 col 升序摆放即可）：
   * 顶行＝左→右，左翼＝下→上，右翼＝上→下，底行恒 0（只放本人）。
   */
  col: number;
  /** 该分区总席位数（端上可据此居中排布；顶行 2–5、左右翼 0–2、底行恒 1） */
  rowSize: number;
}

/**
 * 席位分布：**自己恒独占底行**，其余按「自己起顺时针」排布（与规则里
 * 「自持币者起顺时针」同一方向），支持 5–10 人局与观战视角。
 *
 * - `k = (seat − selfSeat + count) % count`，`k = 0` 就是自己；
 * - 底行恒 1 席（本人）——底行整块留给「自己 + 手牌空间」（见 docs/UI-OVERHAUL-PLAN.md §5.1）；
 *   其余 `others = count − 1` 席按顺时针填 左翼 → 顶行 → 右翼；
 * - 两翼每侧席位数：7–8 人局各 2（卡片变矮后靠加高两翼吃下），5–6 人局各 1；顶行吃掉剩余。
 *   形态表（底行恒「自己」1 席）：
 *   5 人 = 顶 2 + 左右各 1；6 人 = 顶 3 + 左右各 1；
 *   7 人 = 顶 2 + 左右各 2；8 人 = 顶 3 + 左右各 2；
 * - ≥9 人超出牌桌容量（环绕形态最多 8 人：顶 3 + 左右各 2 + 底 1），端上自行切紧凑列表兜底，
 *   本函数仍按「左右各 2 + 顶 count−5」给出可用的分布（顶行 4–5 张，端上不该用）；
 * - 顺时针序即：左翼（下→上）→ 顶行（左→右）→ 右翼（上→下）；`col` 是分区内的顺时针序号，
 *   端上按 col 升序摆放即可（左翼靠 column-reverse 让 col 0 的下家贴向底行的自己）；
 * - `selfSeat` 为 null（观战 / 全局视图）时按 0 处理；`count < 1` 或非整数时返回空数组，
 *   座位号越界按取模归一（不会抛错，端上不必先校验）。
 */
export function seatLayout(selfSeat: number | null, count: number): SeatSlot[] {
  if (!Number.isInteger(count) || count < 1) return [];
  const self = selfSeat === null ? 0 : ((selfSeat % count) + count) % count;
  /** 两翼每侧席位数：7–8 人局各 2，5–6 人局各 1（更小的人数全部塞进顶行） */
  const perWing = count >= 7 ? 2 : count >= 5 ? 1 : 0;
  /** 顶行吃掉两翼之后剩下的席位 */
  const topSize = Math.max(0, count - 1 - perWing * 2);

  const slotOfK = (k: number): SeatSlot => {
    const id = String((self + k) % count);
    if (k === 0) return { id, zone: 'bottom', col: 0, rowSize: 1 };
    const idx = k - 1; // 0 = 下家（顺时针首席，落左翼）
    if (idx < perWing) return { id, zone: 'left', col: idx, rowSize: perWing };
    if (idx < perWing + topSize) return { id, zone: 'top', col: idx - perWing, rowSize: topSize };
    return { id, zone: 'right', col: idx - perWing - topSize, rowSize: perWing };
  };

  return Array.from({ length: count }, (_, k) => slotOfK(k));
}

/**
 * 顶行在给定视口宽度下放不放得下（环绕席位的宽度门控）。
 *
 * 9–10 人局顶行有 4–5 张席位卡，超出「顶行最多 3 张」的窄视口预算会横向溢出（最右出屏），
 * 端上据此门控「环绕席位」切换并自动回落紧凑列表。席位卡宽度与间距取 styles.css 的同一套
 * 参数（clamp(86px, 27vw, 132px)；≤560px 窄屏档 padding 10px / gap 6px，更宽 14px / 10px），
 * CSS 参数改动时须同步本函数。
 */
export function topRowFits(viewportWidth: number, topSize: number): boolean {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return false;
  if (!Number.isInteger(topSize) || topSize < 0) return false;
  if (topSize === 0) return true;
  const narrow = viewportWidth <= 560;
  const padding = narrow ? 10 : 14;
  const gap = narrow ? 6 : 10;
  const card = Math.min(Math.max(86, viewportWidth * 0.27), 132);
  return padding * 2 + card * topSize + gap * (topSize - 1) <= viewportWidth;
}

/**
 * 席位卡上要显示的一个标记。
 * `key` 是语义标识（端上可据此换成图标角标而不动共享逻辑），`text` 是当前界面的文案。
 */
export interface SeatToken {
  key:
    | 'ai'
    | 'offline'
    | 'mustPlay'
    | 'mustPlayRandom'
    | 'mustPass'
    | 'mustRedraw'
    | 'goLast'
    | 'pair'
    | 'played'
    | 'passed';
  text: string;
  /** 次要状态用灰色显示（与「已出牌」的金色区分） */
  gray?: boolean;
}

/** 一位玩家在席位卡上的全部可显示信息（全部来自下发的视图与本机平台状态） */
export interface SeatVisual {
  /** 座位号文案（1 起，与界面「座位 N」一致） */
  seatLabel: string;
  /** 是否是当前视角本人 */
  isSelf: boolean;
  handCount: number;
  /** 本轮持币（界面用硬币图案表示，不出文字） */
  coin: boolean;
  crystal: {
    /** 水晶编号；本人恒有值，其他人只有放上版图后（crystalTrack 成为公开信息）才有 */
    value: number | null;
    placed: boolean;
    /** 编号文本；未知时为空串 */
    label: string;
  };
  /** 行末标签：顺序与既有界面一致 */
  tokens: SeatToken[];
}

/**
 * 把「下发的视图 + 本机记录的在线/托管状态」映射为席位卡要显示的内容。
 *
 * 为什么入参不是「单个 player」（方案 §6.3 的示意签名）：标签来自 `view.modifiers` 与
 * `view.pendingRedraw`，硬币来自 `view.coinHolder`，断线 / AI 托管来自平台侧（Web 端是服务器
 * 下发的 seatStatus，热座恒为在线）——三样都拿不到就必然与界面现有实现分成两套。
 * 口径与 `Board.tsx` 的行末标签、水晶编号逻辑**逐字对齐**（由 `scene.test.ts` 锁死）。
 */
export function seatVisualOf(
  view: GameView,
  player: PlayerViewEntry,
  presence?: { offline: boolean; ai: boolean },
): SeatVisual {
  const tokens: SeatToken[] = [];
  // 断线 / 托管放在最前：一眼能看到谁掉线了、谁由 AI 代操作
  if (presence?.ai) tokens.push({ key: 'ai', text: 'AI 托管', gray: true });
  else if (presence?.offline) tokens.push({ key: 'offline', text: '断线中', gray: true });
  if (view.modifiers.mustPlay.includes(player.id)) tokens.push({ key: 'mustPlay', text: '必须出牌' });
  if (view.modifiers.mustPlayRandom.includes(player.id))
    tokens.push({ key: 'mustPlayRandom', text: '随机出牌' });
  if (view.modifiers.mustPass.includes(player.id)) tokens.push({ key: 'mustPass', text: '必须跳过' });
  if (view.pendingRedraw === player.id) tokens.push({ key: 'mustRedraw', text: '必须换牌' });
  if (view.modifiers.goLastOption === player.id && !view.modifiers.goLastUsed)
    tokens.push({ key: 'goLast', text: '可殿后' });
  if (view.modifiers.pairs.some((pair) => pair.includes(player.id)))
    tokens.push({ key: 'pair', text: '行动绑定' });
  if (player.played) tokens.push({ key: 'played', text: '已出牌' });
  if (player.passed) tokens.push({ key: 'passed', text: '已跳过', gray: true });

  const value = player.crystal ?? view.crystalTrack.find((t) => t.player === player.id)?.value;

  return {
    seatLabel: String(player.seat + 1),
    isSelf: view.viewer === player.id,
    handCount: player.handCount,
    coin: view.coinHolder === player.id,
    crystal: {
      value: value ?? null,
      placed: player.crystalPlaced,
      label: value === undefined ? '' : String(value),
    },
    tokens,
  };
}

/** 卡面语义（不含图片本身）：画心种类、显示名、主色调 */
export interface CardFaceInfo {
  /** 画心种类，对应 `assets/cards/card-<kind>.webp` */
  kind: string;
  /** 卡牌显示名（幽魂 / 信者 / 角色名） */
  label: string;
  /** 主色调所属阵营；幽魂为 neutral（不属任何阵营） */
  tone: Faction | 'neutral';
}

/**
 * 卡牌 → 卡面语义。`kind` 与 `label` 的口径与 `cards.tsx` 的 `cardArtKind` / `cardLabel` 一致
 * （那边已改为委托本函数，避免两套映射分叉）；`tone` 取角色的阵营（`FACTION_OF`）。
 */
export function cardFaceOf(card: Card): CardFaceInfo {
  const kind = card.kind === 'role' ? card.role : card.kind;
  const label = card.kind === 'ghost' ? '幽魂' : card.kind === 'believer' ? '信者' : ROLE_LABEL[card.role];
  const tone: Faction | 'neutral' =
    card.kind === 'ghost'
      ? 'neutral'
      : card.kind === 'believer'
        ? FACTION_OF.believer
        : FACTION_OF[card.role];
  return { kind, label, tone };
}
