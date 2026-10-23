/**
 * 热座调试门控。
 *
 * 「本地热座」是规则调试工具（单窗口切换全部视角），只对开发者开放：
 * 开发模式（npm run dev）可用；生产构建（npm run build）彻底不渲染热座入口，
 * URL hash 直入热座也被拒绝并回落大厅。联机模式不受任何影响。
 *
 * 开关在构建时静态确定（import.meta.env.DEV），生产构建里关闭分支会被摇掉。
 * 纯逻辑（解析、判定）与环境读取分层，便于单测两种分支。
 */
import { parseDistribution, validateDistribution, type Distribution } from '../engine';
import { PLAYER_COUNTS } from './distribution';

/** 是否允许使用热座调试（纯函数；override 用于测试与将来可能的显式覆盖） */
export function resolveHotseatDebug(input: { dev: boolean; override?: boolean }): boolean {
  return input.override ?? input.dev;
}

/**
 * 热座调试开关：仅开发模式开启。
 * 写成静态可折叠表达式——生产构建里 `import.meta.env.DEV` 被替换为 false，
 * 打包器会把整个关闭分支（含热座文案）摇掉，产物不带调试入口的任何痕迹。
 */
export const HOTSEAT_DEBUG: boolean = import.meta.env.DEV
  ? resolveHotseatDebug({ dev: true })
  : false;

export interface HashState {
  players: number;
  seat: string | null;
  /** 联机房间号；null 表示本地热座 */
  room: string | null;
  dist: Distribution | null;
  valid: boolean;
  /** 逃生阀：带 lobby=1 时即使有进行中的对局也留在大厅（调试用；进入房间后自然清掉） */
  forceLobby: boolean;
}

/** 开发者授权门控状态：checking = 正在向服务器复核本机授权 */
export type DevGate = 'checking' | 'unlocked' | 'locked';

/**
 * 门控初值（纯函数）：开发模式直接解锁；本地存有开发者授权时先向服务器复核（checking）；否则锁定。
 * 生产构建里热座 = 构建开关 OR 开发者授权，授权由服务器签发（登录开发者账号获得）。
 */
export function resolveDevGate(input: { hotseatDebug: boolean; hasToken: boolean }): DevGate {
  if (input.hotseatDebug) return 'unlocked';
  return input.hasToken ? 'checking' : 'locked';
}

/**
 * 解析 URL hash（纯函数）。
 * 热座调试关闭时，热座 hash（不带 room）一律判为无效，回落大厅重新编辑。
 */
export function parseHash(hash: string, hotseatDebug: boolean): HashState {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const players = Number(params.get('players'));
  const spectate = params.get('spectate') === '1';
  const seat = params.get('seat');
  const room = (params.get('room') ?? '').trim() || null;
  const dist = parseDistribution(params.get('d') ?? '');
  const forceLobby = params.get('lobby') === '1';
  // 配比非法（合计不符、白蔷薇/暗刃不为 1 等）时不直接进对局，回落到大厅重新编辑
  const distValid = dist === null || validateDistribution(dist, players) === null;
  const seatValid = seat !== null && seat !== '' && Number(seat) >= 0 && Number(seat) < players;
  const valid =
    PLAYER_COUNTS.includes(players) &&
    (spectate ? room !== null : seatValid) &&
    distValid &&
    // 热座（无 room）仅调试开启时有效：生产构建拒绝 hash 直入热座
    (room !== null || hotseatDebug);
  return { players, seat: spectate ? null : seat, room, dist, valid, forceLobby };
}

/**
 * hash 是否指向「热座直入」（无 room 且按调试开启口径解析有效）。
 * 生产构建的初始解析不会放行热座，开发者授权解锁后由启动效果据此延后放行。
 */
export function hashTargetsHotseat(hash: string): boolean {
  const state = parseHash(hash, true);
  return state.valid && state.room === null;
}
