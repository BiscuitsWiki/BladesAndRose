/**
 * 「用 UID 认领座位」的决策逻辑。
 *
 * 独立成文件（不放进 dev-server.ts）的原因：dev-server 在 import 时就会启动服务器并监听端口，
 * 单测无法 import 它；把决策抽成纯函数即可直接单测（决策表见下方注释）。
 *
 * 与既有凭据机制的关系：
 *   - 凭据仍是连接与动作的通行证（boardgame.io 校验），本函数只决定「谁可以拿到哪个座位的凭据」；
 *   - 座位与 UID 的绑定存在服务器内存表（roomExtras.uids），不下发给客户端。
 */

export interface ClaimSeatMeta {
  name?: string;
  credentials?: string;
}

/**
 * 该键是否是房间元数据里的合法座位号（「自有键 + 纯数字」）。
 *
 * 必须显式排除 `__proto__` / `constructor` / `toString` 一类原型链键：以它们索引 `players`
 * 会读到原型上的对象或函数（不是 undefined），随后往里写 `name` / `credentials` 就会落到
 * Object.prototype 上，造成进程级原型污染（会破坏凭据校验与房间状态，见安全审查 HIGH）。
 */
export function isSeatKey(players: Record<string, unknown>, seat: string): boolean {
  return /^\d+$/.test(seat) && Object.prototype.hasOwnProperty.call(players, seat);
}

/** 取房间元数据里的座位条目：只认自有座位键（原型链键一律视为不存在） */
export function seatMetaOf<T>(players: Record<string, T | undefined>, seat: string): T | undefined {
  return isSeatKey(players, seat) ? players[seat] : undefined;
}

/** 座位号在消息里的写法：数字座位按 1 起显示，非法键原样展示（便于排查恶意请求） */
function seatLabel(seat: string): string {
  return /^\d+$/.test(seat) ? `座位 ${Number(seat) + 1}` : `座位「${seat}」`;
}

export interface SeatClaimInput {
  /** 房间元数据里的座位 → { name?, credentials? } */
  players: Record<string, ClaimSeatMeta | undefined>;
  /** 座位号 → 绑定的 UID（服务器内存表） */
  uids: ReadonlyMap<string, string>;
  seat: string;
  /** 请求方出示的 UID（已由调用方校验格式） */
  uid: string;
  /** 请求方本机现有的座位凭据（用于给「已占用但未绑定 UID」的旧房间补绑） */
  credentials?: string | null;
}

/**
 * 决策表：
 *   已占用 + 绑定 === uid                    → reclaim（归还现有凭据，不轮换）
 *   已占用 + 未绑定 + 请求凭据 === 座位凭据   → rebind（补绑本 UID，归还现有凭据）
 *   已占用 + 未绑定 + 凭据不匹配              → 409 seat-unbound
 *   已占用 + 绑定 !== uid                    → 403 seat-taken
 *   空座位（无论是否有旧绑定）                → occupy（写名字 + 绑 UID；与「空位可入座」的既有行为一致）
 *   座位号不存在                             → 404 seat-not-found
 *
 * 凭据不轮换的原因：保留现状「同一 UID 两窗口同座位可共存」；否则第二个窗口认领会把
 * 第一个窗口踢成 unauthorized，还会让 hostToken（房主身份绑定的凭据）失效。
 */
export type SeatClaimDecision =
  | { kind: 'reclaim'; credentials: string }
  | { kind: 'rebind'; credentials: string }
  | { kind: 'occupy' }
  | { kind: 'error'; status: 403 | 404 | 409; code: string; message: string };

export function decideSeatClaim(input: SeatClaimInput): SeatClaimDecision {
  const { players, uids, seat, uid, credentials } = input;
  // 只认自有座位键：原型链键（__proto__ / constructor 等）读到的不是真实座位，一律按不存在处理
  if (!isSeatKey(players, seat)) {
    return { kind: 'error', status: 404, code: 'no-seat', message: `${seatLabel(seat)} 不存在` };
  }
  const occupant = players[seat]!;

  if (occupant.name) {
    const bound = uids.get(seat);
    if (bound === uid && occupant.credentials) {
      return { kind: 'reclaim', credentials: occupant.credentials };
    }
    if (bound === undefined && credentials && credentials === occupant.credentials) {
      // 旧房间（用内置 join 入座、没有 UID 绑定）：凭据对得上就补绑
      return { kind: 'rebind', credentials: occupant.credentials! };
    }
    if (bound === undefined) {
      return {
        kind: 'error',
        status: 409,
        code: 'seat-unbound',
        message: `${seatLabel(seat)} 已被占用，请换一个座位，或让房主重开房间`,
      };
    }
    return {
      kind: 'error',
      status: 403,
      code: 'seat-taken',
      message: `${seatLabel(seat)} 已被其他玩家占用`,
    };
  }

  return { kind: 'occupy' };
}

export interface ActiveGameCandidate {
  room: string;
  updatedAt: number;
}

/** 选「最近活跃」的一局：updatedAt 降序，同值时按房间号字符串序（保证结果确定） */
export function pickLatestGame<T extends ActiveGameCandidate>(games: T[]): T | null {
  if (games.length === 0) return null;
  return games.reduce((latest, game) => {
    if (game.updatedAt > latest.updatedAt) return game;
    if (game.updatedAt === latest.updatedAt && game.room > latest.room) return game;
    return latest;
  });
}