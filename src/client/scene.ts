/**
 * 场景纯函数 —— 表现层共享层（docs/UI-OVERHAUL-PLAN.md §6.3）。
 *
 * 分工：「决定做什么」是这里的纯函数，「怎么画」由各端自己写（Web 端 DOM / CSS / SVG，
 * 小程序端 WXSS / Canvas 2D）。因此本文件**不依赖 React / DOM / window**，只 import engine 的
 * 常量与 type-only 类型，返回值全部是可序列化的原始值——小程序端（阶段三）要原样复用这一份。
 *
 * 坐标约定（`seatLayout` 的 x / y）：相对「席位环容器」的 0–1 比例，端上用
 * `left: x*100%; top: y*100%; translate(-50%, -50%)` 定位。点落在半径 0.5 的圆上，
 * **椭圆化交给容器宽高比**（不施加 scale，卡片 rotate 才不会被裁切）；x 会取到 0 与 1 附近的
 * 极值，故容器需留安全内边距——两端按约 8% inset 处理即可（此约定写在这里，供两端对齐）。
 */
import {
  FACTION_OF,
  ROLE_LABEL,
  type Card,
  type Faction,
  type GameView,
  type PlayerViewEntry,
} from '../engine';

/** 保留 6 位小数：避免 cos/sin 的浮点尾巴（如 cos 90° = 6.1e-17）；-0 归一为 0 */
function round6(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded;
}

/** 归一化到 (−180, 180] */
function normalizeAngle(deg: number): number {
  let value = deg % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return value;
}

/** 席位在环上的位置与朝向 */
export interface SeatSlot {
  /** 座位号（0 起，与 boardgame.io 的 playerID 一致） */
  id: string;
  /** 相对席位环容器的横向比例（0–1） */
  x: number;
  /** 相对席位环容器的纵向比例（0–1，向下为正） */
  y: number;
  /** 席位卡应施加的旋转角（度，顺时针为正）：0 = 正立（自己）、对面 = 180 */
  angle: number;
}

/**
 * 席位环布局：**自己恒在底部居中**，其余按「自己起顺时针」排布（与规则里
 * 「自持币者起顺时针」同一方向），支持 5–10 人局与观战视角。
 *
 * - `k = (seat − selfSeat + count) % count`，`k = 0` 就是自己；
 * - 环角 `φ = 90° + k·360°/count`，`x = 0.5 + 0.5·cosφ`、`y = 0.5 + 0.5·sinφ`
 *   （y 向下 ⇒ φ 增大即屏幕顺时针）；k=1 落在左下（我的下家），偶数局 k=count/2 在正上方；
 * - `selfSeat` 为 null（观战 / 全局视图）时按 0 处理；`count < 1` 或非整数时返回空数组，
 *   座位号越界按取模归一（不会抛错，端上不必先校验）。
 */
export function seatLayout(selfSeat: number | null, count: number): SeatSlot[] {
  if (!Number.isInteger(count) || count < 1) return [];
  const self = selfSeat === null ? 0 : ((selfSeat % count) + count) % count;
  return Array.from({ length: count }, (_, k) => {
    const phiDeg = 90 + (k * 360) / count;
    const phi = (phiDeg * Math.PI) / 180;
    return {
      id: String((self + k) % count),
      x: round6(0.5 + 0.5 * Math.cos(phi)),
      y: round6(0.5 + 0.5 * Math.sin(phi)),
      angle: round6(normalizeAngle(phiDeg - 90)),
    };
  });
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
