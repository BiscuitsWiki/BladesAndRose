/**
 * 场景纯函数 —— 表现层共享层（docs/UI-OVERHAUL-PLAN.md §6.3）。
 *
 * 分工：「决定做什么」是这里的纯函数，「怎么画」由各端自己写（Web 端 DOM / CSS / SVG，
 * 小程序端 WXSS / Canvas 2D）。因此本文件**不依赖 React / DOM / window**，只 import engine 的
 * 常量与 type-only 类型，返回值全部是可序列化的原始值——小程序端（阶段三）要原样复用这一份。
 *
 * 分区约定（`seatLayout` 的 zone / col）：牌桌排成「顶行 / 中间（左·桌心·右）/ 底行」三段，
 * `zone` 给出席位落在哪一段，`col` 给出段内从左到右的次序（自己恒在底部居中）。
 * 端上把同一段的席位横排/居中即可，不再做绝对定位——竖版卡宽度随视口收缩也不会互相挤压。
 */
import {
  FACTION_OF,
  ROLE_LABEL,
  type Card,
  type Faction,
  type GameView,
  type PlayerViewEntry,
} from '../engine';

/** 席位所在的桌区分区：顶行（横排 1–3）、左右两翼（各 1）、底行（1–3，自己居中或与下家同行） */
export type SeatZone = 'top' | 'left' | 'right' | 'bottom';

/** 席位在竖版牌桌上的位置与段内次序 */
export interface SeatSlot {
  /** 座位号（0 起，与 boardgame.io 的 playerID 一致） */
  id: string;
  /** 席位所在分区 */
  zone: SeatZone;
  /** 分区内从左到右的序号（left / right 恒 0；bottom 以自己为 col 1） */
  col: number;
  /** 该分区总席位数（端上可据此居中排布；left / right 恒 1） */
  rowSize: number;
}

/**
 * 席位分布：**自己恒在底行**，其余按「自己起顺时针」排布（与规则里
 * 「自持币者起顺时针」同一方向），支持 5–10 人局与观战视角。
 *
 * - `k = (seat − selfSeat + count) % count`，`k = 0` 就是自己；
 * - 形态（按人数；约定：顶 / 底行数量不一致时，底行（自己一侧）更少）：
 *   5 人 = 底 1（自己）+ 左右各 1 + 顶 2；6 人 = 底 2（自己 + 下家）+ 左右各 1 + 顶 2；
 *   7 人 = 底 2（自己 + 下家）+ 左右各 1 + 顶 3；8 人 = 底 3（自己 + 下家 / 上家）+ 顶 3；
 *   ≥9 人超出竖版牌桌容量（顶 3 + 底 3 + 左右 2 = 8），端上自行切紧凑列表兜底，本函数仍按
 *   「底 3 + 左右各 1 + 顶 n−5」给出可用的分布（顶行会到 4–5 张，端上不该用）；
 * - 顺时针序即：底行左（下家）→ 左翼 → 顶行（左→右）→ 右翼 → 底行右（上家）；
 *   5 人局没有底行补位，下家直接落在左翼；6–7 人局下家贴在自己左侧、上家落在右翼；
 *   8 人局上下家分列底行两侧；
 * - `selfSeat` 为 null（观战 / 全局视图）时按 0 处理；`count < 1` 或非整数时返回空数组，
 *   座位号越界按取模归一（不会抛错，端上不必先校验）。
 */
export function seatLayout(selfSeat: number | null, count: number): SeatSlot[] {
  if (!Number.isInteger(count) || count < 1) return [];
  const self = selfSeat === null ? 0 : ((selfSeat % count) + count) % count;
  /** 左右两翼各一席：5 人局起启用（更小的人数全部塞进顶行） */
  const side = count >= 5;
  /**
   * 底行席位数：除自己外的席位先尽量平分给顶 / 底行，底行不超过顶行（顶底不一致时
   * 底行更少，自己一侧留白）且至多 3 席——得到 5人=1、6–7人=2、≥8人=3。
   */
  const bottomSize = Math.max(1, Math.min(3, Math.floor((count - 2) / 2)));
  /** 自己在底行内的列：单席即居中；多席时占中位（下家在左，底行 3 席时上家在右） */
  const selfCol = bottomSize === 1 ? 0 : 1;
  const topSize = Math.max(0, count - bottomSize - (side ? 2 : 0));

  /** 底行占用的顺时针位：自己 + 下家（底行 ≥2 席时）+ 上家（底行 3 席时） */
  const bottomKs = new Set<number>([0]);
  if (bottomSize >= 2) bottomKs.add(1);
  if (bottomSize >= 3) bottomKs.add(count - 1);

  /** 去掉底行占用后、按顺时针剩下的 k（依次填 左翼 → 顶行 → 右翼） */
  const middle: number[] = [];
  for (let k = 1; k < count; k++) {
    if (bottomKs.has(k)) continue;
    middle.push(k);
  }

  const slotOfK = (k: number): SeatSlot => {
    const id = String((self + k) % count);
    if (k === 0) return { id, zone: 'bottom', col: selfCol, rowSize: bottomSize };
    if (k === 1 && bottomSize >= 2) return { id, zone: 'bottom', col: 0, rowSize: bottomSize };
    if (k === count - 1 && bottomSize >= 3)
      return { id, zone: 'bottom', col: 2, rowSize: bottomSize };
    const idx = middle.indexOf(k);
    if (side && idx === 0) return { id, zone: 'left', col: 0, rowSize: 1 };
    if (side && idx === middle.length - 1) return { id, zone: 'right', col: 0, rowSize: 1 };
    return { id, zone: 'top', col: idx - (side ? 1 : 0), rowSize: topSize };
  };

  return Array.from({ length: count }, (_, k) => slotOfK(k));
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
