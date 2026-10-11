/**
 * 开发用房间服务器。
 *
 * 以 watch 模式运行（npm run dev:server）：引擎 / 服务器源码改动会自动重启，
 * 但内存中的房间会随重启清空，测试者重新进入房间号即可（对局按新代码重建）。
 *
 * 让多个浏览器窗口 / 设备通过同一个房间号进入同一局：
 *   1. npm run dev:server    # 本文件，监听 8000（内存存储，无数据库、无认证）
 *   2. 各测试者打开同一房间号（相同人数与配比）：
 *      http://localhost:5173/#players=6&seat=0&room=test1
 *      http://10.48.27.83:5173/#players=6&seat=1&room=test1   （同 WiFi 的手机/平板）
 *
 * 房间由首个连接者进入时按客户端人数自动创建，无需大厅流程。
 * 进入房间后是「等待开局」状态：先在座位面板就位，房主（创建房间的玩家）点「开始游戏」后牌桌才显示。
 * 自定义配比通过「game 变体」承载：每个合法配比注册为一个独立 game（名称 = 配比签名），
 * 客户端按 URL 中的配比选择同名 game，socket.io 据此路由到对应命名空间——
 * 因此同一房间号下，配比不同的玩家天然进入不同对局（进入前请对齐人数与配比）。
 *
 * 断线规则：未开局时断线超过 1 分钟按退出房间处理；对局进行中座位保留到本局结束，
 * 断线超过 3 分钟改由 AI 暂时托管（出牌跳过、技能随机选人），本人回来即撤销托管。
 *
 * 身份：玩家有系统发放的唯一 UID（游客 10 位 / 专属账号 9 位，见 accounts.ts），
 * 座位与 UID 的绑定记在房间内存表（roomExtras.uids，不下发给客户端）。
 * 客户端回到主页时可凭 UID 收回自己的座位、并被自动拉回进行中的对局（见 /seat-claim、/active-game）。
 * 账号表落盘在 data/accounts.json（可用环境变量 BLADES_ACCOUNTS_FILE 覆盖），跨重启保留；
 * 房间与对局仍只在进程内存里（watch 重启即清空，测试者重新进房间号即可）。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Server } from 'boardgame.io/server';
import { createMatch as createMatchRecord } from 'boardgame.io/internal';
import koaBody from 'koa-body';
import { io } from 'socket.io-client';
import {
  LOADOUT_BASE,
  LOADOUT_PRESETS,
  autoMoveFor,
  loadoutPresetId,
  loadoutSignature,
  MAX_PLAYERS,
  MIN_PLAYERS,
  resolveLoadout,
  sameLoadout,
  validateLoadout,
  type Distribution,
  type GameState,
  type Move,
  type SkillLoadout,
} from '../engine';
import { getBladesAndRose } from '../client/game';
import { AccountStore, uidKind } from './accounts';
import { hitRateWindow, pruneExpired, type RateWindow } from './rateLimit';
import { decideSeatClaim, pickLatestGame, seatMetaOf } from './seats';

/** 监听端口：容器 / 生产环境用环境变量 PORT 覆盖，开发默认 8000（与客户端 ROOM_SERVER_PORT 一致） */
const PORT = Number(process.env.PORT ?? 8000);

/**
 * 房主与座位号无关：房主是「创建房间的玩家」，记录在 roomExtras.hostSeat 里，并绑定该座位的凭据。
 * 首次由最小已入座座位推得（最先入座者 = 创建者）；房主可把房主转给其他已入座玩家。
 * 房主离座、或该座位换了人：立即顺位给最小已入座座位（不给宽限，避免被新入座者顶替）；
 * 只有「仍坐在原座位但断线」（刷新 / 掉线）才有这个宽限期。
 */
const HOST_GRACE_MS = 15_000;

/**
 * 空房间留存期：房间里没有任何「在座且在线」的玩家时开始计时（都断线 / 都离座 / 还没人入座）。
 * 期间有人进入并入座 → 房间继续存活（第一位入座者成为房主）；到期仍无人 → 销毁房间（房间码失效）。
 */
const RETAIN_EMPTY_MS = 3 * 60_000;

/**
 * 断线离场阈值：**未开局**（还在等人 / 等人点开始）或**对局已结束**时，在座玩家断线超过
 * 这么久还没重连，就按「退出房间」处理（释放座位）。客户端面板上该座位在此期间显示为灰色。
 *
 * 对局进行中不释放座位：断线者留在房间里直到本局结束，超时改由 AI 暂时托管（见下）。
 */
const OFFLINE_LEAVE_MS = 60_000;

/**
 * AI 托管阈值：对局进行中，在座玩家断线超过这么久仍未回来，就由服务器 AI 暂时接替其操作
 * （出牌一律跳过、技能随机选人，见 engine 的 autoMoveFor）。本人回来即撤销托管，
 * 座位与对局状态全程保留。
 */
const AI_TAKEOVER_MS = 3 * 60_000;

/** 一趟巡检里最多替 AI 连打几个动作：一个动作常把阶段推进给下一个托管座位 */
const MAX_AI_ACTIONS_PER_SWEEP = 5;

/** 房间巡检间隔：断线处理与空房回收共用（服务器后台定时检查，客户端全走了也照常工作） */
const EMPTY_SWEEP_MS = 5_000;

// boardgame.io 0.45+ 默认关闭 CORS，必须显式声明允许的来源。
// 开发期放开本机与任意局域网 IP（手机等设备经由 http://<局域网 IP>:5173 访问 vite）。
const ORIGINS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^http:\/\/\d{1,3}(\.\d{1,3}){3}(:\d+)?$/,
];

/**
 * 枚举所有合法配比：白蔷薇、暗刃固定各 1 名，司教/信者/双刃/巨刃自由分配，
 * 合计等于人数。5–10 人合计 480 种。
 */
function allDistributions(): Distribution[] {
  const list: Distribution[] = [];
  for (let players = MIN_PLAYERS; players <= MAX_PLAYERS; players++) {
    const sum = players - 2; // 白蔷薇 1 + 暗刃 1
    for (let bishop = 0; bishop <= sum; bishop++) {
      for (let believer = 0; believer <= sum - bishop; believer++) {
        for (let doubleBlade = 0; doubleBlade <= sum - bishop - believer; doubleBlade++) {
          list.push({
            whiteRose: 1,
            bishop,
            believer,
            doubleBlade,
            greatBlade: sum - bishop - believer - doubleBlade,
            darkBlade: 1,
          });
        }
      }
    }
  }
  return list;
}

// 官方配比（'blades-and-rose'，按人数取官方值）+ 全部自定义配比变体
const games = [getBladesAndRose(null), ...allDistributions().map((d) => getBladesAndRose(d))];

const server = Server({ games, origins: ORIGINS });

/**
 * 座位表防原型污染。
 *
 * boardgame.io 内置的 join / leave 等端点直接以 playerID 为键读写房间元数据的
 * `metadata.players`（`players[playerID]`，见 node_modules 里 server.js 的 join/leave 实现）。
 * 传入 `__proto__` / `constructor` 这类原型链键时，读到的是 Object.prototype / Object 函数
 * （不是 undefined），随后的写入会落到原型上，造成**进程级原型污染**：房间元数据里的空座位
 * 会被读成「已占用」，凭据校验也会读到注入值（安全审查 HIGH）。
 *
 * 建房时把座位表换成「无原型对象」（`Object.create(null)`），原型链键读到的永远是 undefined，
 * 库端点会正常按「座位不存在」拒绝。自定义端点另有 `isSeatKey` / `decideSeatClaim` 的显式校验。
 */
function hardenSeatTable(): void {
  const db = server.db as unknown as {
    createMatch(matchID: string, opts: { metadata?: { players?: Record<string, unknown> } }): unknown;
  };
  const createMatch = db.createMatch.bind(db);
  db.createMatch = (matchID, opts) => {
    const players = opts?.metadata?.players;
    if (players) opts.metadata!.players = Object.assign(Object.create(null), players);
    return createMatch(matchID, opts);
  };
}
hardenSeatTable();

/**
 * 服务器侧建局（技能组方案 §8）：用房间当前技能组组 setupData，经 boardgame.io/internal 的
 * createMatch（内含 validateSetupData 与 InitializeGame）生成 { initialState, metadata } 后落库。
 *
 * 不用 REST /games/:name/create 的原因：它的 matchID 由库生成 uuid，无法使用本项目的 6 位房间码；
 * 而 InMemory 存储的 createMatch 会把 initialState 同时写入 state，
 * 因此预建的对局不会被随后客户端 socket 同步时的「按需自动建房」覆盖。
 */
async function createMatchWithLoadout(opts: {
  matchID: string;
  gameName: string;
  numPlayers: number;
  loadout: SkillLoadout;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const game = games.find((g) => g.name === opts.gameName);
  if (!game) return { ok: false, error: `未知的配比变体：${opts.gameName}` };
  if (
    !Number.isInteger(opts.numPlayers) ||
    opts.numPlayers < MIN_PLAYERS ||
    opts.numPlayers > MAX_PLAYERS
  ) {
    return { ok: false, error: `人数必须在 ${MIN_PLAYERS}-${MAX_PLAYERS} 之间` };
  }
  const record = createMatchRecord({
    game,
    numPlayers: opts.numPlayers,
    setupData: { loadout: opts.loadout },
    unlisted: true,
  });
  if ('setupDataError' in record) return { ok: false, error: record.setupDataError };
  try {
    await server.db.createMatch(opts.matchID, record);
  } catch (error) {
    return { ok: false, error: `建局失败：${(error as Error).message}` };
  }
  return { ok: true };
}

/** 前端构建产物目录（vite build 输出）；开发时通常不存在 */
const DIST_DIR = path.resolve(process.cwd(), 'dist');

/** 静态资源类型表（未列出的按二进制下发） */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * 生产形态：由同一个进程托管前端构建产物 —— 前端与 API / socket.io 同源，
 * 免 CORS、免额外端口，也不需要在反向代理里拆路径。
 *
 * 注册时机在路由之后（run() 已把 router.routes() 挂上），因此只处理「没有命中任何接口」的请求：
 *   - 命中 dist 内的真实文件 → 按类型下发；带哈希的 /assets/ 长缓存，其余 no-cache；
 *   - 带扩展名但不存在 → 交给后续中间件（404），不回落，避免把缺失资源伪装成页面；
 *   - 不带扩展名（/、/abc 等）→ 回落 index.html（前端用 hash 路由，直接访问/刷新都能开）。
 *
 * 开发模式（没有 dist/index.html）不注册任何东西，行为与之前完全一致。
 */
function registerStaticSite(): void {
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (!existsSync(indexPath)) return;

  server.app.use(async (ctx, next) => {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return next();
    const urlPath = decodeURIComponent(ctx.path);
    const target = path.resolve(DIST_DIR, urlPath.replace(/^\/+/, ''));
    // 路径穿越防护：解析结果必须仍在 dist 目录内
    if (target !== DIST_DIR && !target.startsWith(DIST_DIR + path.sep)) return next();

    let filePath = target;
    if (!(existsSync(filePath) && statSync(filePath).isFile())) {
      if (path.extname(urlPath) !== '') return next();
      filePath = indexPath;
    }

    ctx.type = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    ctx.set(
      'Cache-Control',
      filePath.startsWith(path.join(DIST_DIR, 'assets') + path.sep)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
    ctx.body = await readFile(filePath);
  });
  console.log(`静态站点已托管：${DIST_DIR}（前端与 API 同源）`);
}

/**
 * 按 IP 限流：公网暴露后挡住「刷接口」——无限发游客号会让账号表膨胀、无限建房会占内存。
 * 阈值给得宽松（正常玩家一局里房间面板每 3 秒轮询一次 ≈ 20 次/分/标签页，远达不到）。
 */
interface RateContext {
  /** 套接字对端地址（判断是否来自本机反向代理） */
  ip: string;
  status: number;
  body: unknown;
  set(field: string, value: string): void;
  socket: { remoteAddress?: string };
  request: { headers: Record<string, string | string[] | undefined> };
}

/** 限流窗口表：key = 作用域 + IP */
const rateWindows = new Map<string, RateWindow>();

/** 状态表超过这么多条目时顺手清理过期窗口（正常规模下几乎不触发） */
const RATE_WINDOW_PRUNE_THRESHOLD = 2000;

/**
 * 取客户端 IP：
 *   - 直连（当前形态）用套接字对端地址，伪造 X-Forwarded-For 无效；
 *   - 对端是本机回环（即前置了反向代理，如将来的 Caddy）时才信任 X-Forwarded-For 第一段。
 */
function clientIp(ctx: RateContext): string {
  const peer = ctx.socket.remoteAddress ?? ctx.ip;
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  const forwarded = ctx.request.headers['x-forwarded-for'];
  if (loopback && typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return ctx.ip;
}

/** 命中一次限流：超限时写好 429 响应并返回 false（调用方直接 return） */
function rateAllow(ctx: RateContext, scope: string, limit: number, windowMs = 60_000): boolean {
  const key = `${scope}:${clientIp(ctx)}`;
  const now = Date.now();
  const decision = hitRateWindow(rateWindows.get(key), now, limit, windowMs);
  rateWindows.set(key, decision.window);
  if (rateWindows.size > RATE_WINDOW_PRUNE_THRESHOLD) pruneExpired(rateWindows, now);
  if (decision.allowed) return true;
  ctx.status = 429;
  ctx.set('Retry-After', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
  ctx.body = { error: '请求过于频繁，请稍后再试' };
  console.warn(`[限流] ${key} 超过 ${limit} 次 / ${Math.round(windowMs / 1000)} 秒`);
  return false;
}

/**
 * 房主重开房间。
 *
 * boardgame.io 内置的 leave 在房间有凭据后只退出自己、不清空房间，
 * 因此这里提供一个受凭据保护的重置端点：校验座位凭据 → 只允许当前房主 → 删除整个房间。
 * 其他玩家的旧连接在下次动作时会收到 game not found，刷新后重新加入即可。
 */
function registerResetRoom(): void {
  server.router.post('/reset-room', koaBody(), async (ctx) => {
    if (!rateAllow(ctx, 'room-ops', 60)) return;
    const body = ctx.request.body as
      | { matchID?: unknown; playerID?: unknown; credentials?: unknown }
      | undefined;
    const matchID = typeof body?.matchID === 'string' ? body.matchID : null;
    const playerID = typeof body?.playerID === 'string' ? body.playerID : null;
    const credentials = typeof body?.credentials === 'string' ? body.credentials : null;
    if (!matchID || !playerID) {
      ctx.throw(400, 'matchID and playerID are required');
      return;
    }

    const players = await fetchSeatMeta(matchID);
    if (!players) {
      ctx.throw(404, `Match ${matchID} not found`);
      return;
    }
    // 只认自有座位键：__proto__ / constructor 一类原型链键读到的不是真实座位（见 seats.ts）
    const player = seatMetaOf(players, playerID);
    if (!player?.credentials || player.credentials !== credentials) {
      ctx.throw(403, 'Invalid credentials');
    }
    if (resolveHostSeat(matchID, players) !== playerID) {
      ctx.throw(403, 'Only the host can reset the room');
    }

    await server.db.wipe(matchID);
    // 重开后回到「等待开局」状态：房间号保留，重新进入时按新配置建房再开局；房主待重新入座后推得
    const extra = roomExtras.get(matchID);
    if (extra) {
      extra.started = false;
      extra.hostSeat = null;
      extra.hostToken = null;
      extra.hostAbsentSince = null;
      extra.presence.clear(); // 座位全部作废，连同断线 / 托管记录与 UID 绑定一起清掉
      extra.uids.clear();
    }
    ctx.body = { ok: true };
  });
}

// ---------------------------------------------------------------- 房间扩展信息

/** 房间码字母表（去掉易混的 0/O/1/I） */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 观战者心跳有效期：超过视为已离开 */
const SPECTATOR_TTL = 60_000;

interface SpectatorEntry {
  name: string;
  lastSeen: number;
}

/**
 * 一个座位的在线 / 托管记录（服务器自己维护，不依赖 matchData）：
 * 断线起点用于「1 分钟释放（未开局 / 已结束）」与「3 分钟 AI 托管（对局进行中）」两套规则。
 */
interface SeatPresence {
  /** 首次观察到断线的时间；在线时为 null */
  offlineSince: number | null;
  /** 是否由 AI 暂时托管：对局中断线超过 AI_TAKEOVER_MS 时置位，本人回来即清除 */
  ai: boolean;
}

/** boardgame.io 的房间元数据之外的信息：房间名、开局状态、房主、座位在线记录与观战者心跳（服务器内存） */
const roomExtras = new Map<
  string,
  {
    name: string;
    started: boolean;
    /** 房间技能组（水晶槽 1-12 → 技能 id）：由房主持有、可修改；建局时作为 setupData 固化进对局 */
    loadout: SkillLoadout;
    /** 当前房主的座位号；null = 尚未推得（新房间 / 刚重开） */
    hostSeat: string | null;
    /** hostSeat 上那位房主的座位凭据：座位被清空或换了人（凭据不同）即视为房主已离开 */
    hostToken: string | null;
    /** 房主仍坐原座位但断线的起始时间（宽限期计时）；其余情况为 null */
    hostAbsentSince: number | null;
    /** 房间空置（没有在座且在线的玩家）的起始时间；有人回来 / 入座后清空 */
    emptySince: number | null;
    /** 座位号 → 在线 / 托管记录（座位释放后删除） */
    presence: Map<string, SeatPresence>;
    /**
     * 座位号 → 占用该座位的玩家 UID（身份绑定，用于「凭 UID 收回座位」与「回主页自动拉回」）。
     * 只存服务器内存、随房间一起清理，绝不下发给客户端（UID 相当于可顶替座位的凭据）。
     */
    uids: Map<string, string>;
    spectators: Map<string, SpectatorEntry>;
  }
>();
const issuedRoomCodes = new Set<string>();

/** 玩家账号表（落盘 data/accounts.json）；房间与对局仍是内存存储，账号跨重启保留 */
const accounts = new AccountStore();

/** 生成一条新的座位凭据：boardgame.io 只做字符串相等比较，随机串即可（不轮换，见 seats.ts） */
function newCredential(): string {
  return randomBytes(24).toString('base64url');
}

function roomExtra(matchID: string) {
  let extra = roomExtras.get(matchID);
  if (!extra) {
    extra = {
      name: `房间 ${matchID}`,
      started: false,
      loadout: resolveLoadout(undefined),
      hostSeat: null,
      hostToken: null,
      hostAbsentSince: null,
      emptySince: null,
      presence: new Map<string, SeatPresence>(),
      uids: new Map<string, string>(),
      spectators: new Map<string, SpectatorEntry>(),
    };
    roomExtras.set(matchID, extra);
  }
  return extra;
}

/** 房间技能组的对外表述（房间面板展示用；不含任何隐藏信息）。sig 是技能组签名，供客户端检测变化后重连刷新 */
function skillsetOf(extra: ReturnType<typeof roomExtra>): { id: string | null; name: string; sig: string } {
  const id = loadoutPresetId(extra.loadout);
  const preset = LOADOUT_PRESETS.find((p) => p.id === id);
  return { id, name: preset?.name ?? '自定义技能组', sig: loadoutSignature(extra.loadout) };
}

/**
 * 原地把技能组补写进等待中的对局（改技能组**不再清局**）。
 *
 * 只改 `state.G.skills` 与 `metadata.setupData`，不碰 match 元数据的座位表 / 凭据，
 * 也不碰 roomExtras 的房主、UID 绑定与在线记录——任何玩家都不会被踢出房间、无需刷新。
 * boardgame.io 的 master 每次同步 / 动作都会从存储重新读取状态（见 master.onUpdate），
 * 因此写回后：新同步立即读到新技能组；已连接客户端由 `/room-info` 轮询到 `skillset.sig`
 * 变化后重建连接（= 重新同步）刷新牌桌（开局前牌桌本来就隐藏，整个过程对玩家不可见）。
 *
 * 仅允许用于「尚未开局且尚无人行动」的对局；返回是否修补成功（false = 保持原状）。
 */
async function patchMatchLoadout(matchID: string, loadout: SkillLoadout): Promise<boolean> {
  const { state, metadata } = await server.db.fetch(matchID, { state: true, metadata: true });
  const G = (state as unknown as MasterState | undefined)?.G;
  if (!state || !metadata || !G) return false;
  // 已放出水晶 / 已有人行动 / 已分出胜负：不允许改（对局已经开始）
  if (G.crystalsPlaced > 0 || G.playSequence.length > 0 || G.winner !== null) return false;
  const next = resolveLoadout(loadout);
  const patchedState = { ...state, G: { ...G, skills: next } };
  const patchedMeta = {
    ...metadata,
    setupData: { ...(metadata.setupData as object | undefined), loadout: next },
  };
  await server.db.setState(matchID, patchedState);
  await server.db.setMetadata(matchID, patchedMeta);
  return true;
}

/** 取（必要时创建）某个座位的在线 / 托管记录 */
function seatPresence(extra: ReturnType<typeof roomExtra>, seat: string): SeatPresence {
  let record = extra.presence.get(seat);
  if (!record) {
    record = { offlineSince: null, ai: false };
    extra.presence.set(seat, record);
  }
  return record;
}

function activeSpectators(matchID: string): string[] {
  const extra = roomExtras.get(matchID);
  if (!extra) return [];
  const now = Date.now();
  return [...extra.spectators.values()]
    .filter((entry) => now - entry.lastSeen < SPECTATOR_TTL)
    .map((entry) => entry.name);
}

/** 生成未被使用过的 6 位房间码 */
function newRoomCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!issuedRoomCodes.has(code)) {
      issuedRoomCodes.add(code);
      return code;
    }
  }
}

/** boardgame.io 元数据里的座位信息：有 name = 已入座；isConnected 由 master 在连接 / 断线时维护 */
interface SeatMeta {
  name?: string;
  isConnected?: boolean;
  credentials?: string;
}

async function fetchSeatMeta(matchID: string): Promise<Record<string, SeatMeta> | undefined> {
  const { metadata } = await server.db.fetch(matchID, { metadata: true });
  return metadata?.players as unknown as Record<string, SeatMeta> | undefined;
}

/** master 里的对局状态：巡检只关心 G（AI 决策）、_stateID（提交动作）与对局是否已结束 */
interface MasterState {
  G?: GameState;
  ctx?: { gameover?: unknown };
  _stateID?: number;
}

/** 取对局状态；房间不存在时返回 undefined */
async function fetchMasterState(matchID: string): Promise<MasterState | undefined> {
  const { state } = await server.db.fetch(matchID, { state: true });
  return state as unknown as MasterState | undefined;
}

/** 对局进行中：已开局、对局还在、且尚未分出胜负（此时保留座位、不销毁空房、启用 AI 托管） */
function isGameInProgress(extra: ReturnType<typeof roomExtra>, master: MasterState | undefined): boolean {
  return extra.started && master !== undefined && master.ctx?.gameover === undefined;
}

/** 已占用座位的昵称（来自 boardgame.io 房间元数据里各玩家 join 时写入的 name） */
function occupiedSeats(players: Record<string, SeatMeta> | undefined): Record<string, string> {
  const seats: Record<string, string> = {};
  if (players) {
    for (const [id, player] of Object.entries(players)) {
      if (player?.name) seats[id] = player.name;
    }
  }
  return seats;
}

/** 取最小座位号：按数字比较，避免 "10" 小于 "2" 的字符串陷阱 */
function smallestSeat(seats: string[]): string | null {
  if (seats.length === 0) return null;
  return seats.reduce((min, id) => (Number(id) < Number(min) ? id : min));
}

/** 房间里是否还有「在座且在线」的玩家（isConnected 未定义按在场算：刚入座、还没连上） */
function hasPresentSeated(players: Record<string, SeatMeta> | undefined): boolean {
  if (!players) return false;
  return Object.values(players).some((player) => player?.name && player.isConnected !== false);
}

/**
 * 记录中的房主是否还坐在原座位：座位被清空、或换了人（凭据不同）都不算。
 * 房主身份因此严格绑定到「已入座 + 就是那位房主」——空座位被新玩家坐走不会继承房主。
 */
function stillHostSeat(
  players: Record<string, SeatMeta>,
  hostSeat: string | null,
  hostToken: string | null,
): boolean {
  if (hostSeat === null) return false;
  const occupant = players[hostSeat];
  if (!occupant?.name) return false;
  return occupant.credentials === hostToken;
}

/**
 * 解析当前房主（唯一权威来源；所有需要房主权限的端点都用它判定）：
 *   - 尚未记录（新房间 / 刚重开）：顺位给最小已入座座位（在场优先）——最先入座者就是创建房间的玩家；
 *   - 房主仍在原座位且在线：保持不变（换座由客户端显式转移房主）；
 *   - 房主离座 / 座位换了人：立即顺位给最小已入座座位，并重新绑定凭据；
 *   - 房主仍在原座位但断线（刷新 / 掉线）：宽限期内保留，超时才顺位。
 * 任何一次赋值都只从「已入座座位」中挑选，房主必然是在座玩家。
 */
function resolveHostSeat(matchID: string, players: Record<string, SeatMeta>): string | null {
  const extra = roomExtra(matchID);
  const seated = Object.entries(players)
    .filter(([, player]) => player?.name)
    .map(([id]) => id);
  const present = seated.filter((id) => players[id]?.isConnected !== false);

  /** 顺位：把房主交给最小已入座座位（在场优先），并把身份绑定到该座位的凭据 */
  const handOver = (seat: string | null): string | null => {
    extra.hostSeat = seat;
    extra.hostToken = seat === null ? null : (players[seat]?.credentials ?? null);
    extra.hostAbsentSince = null;
    return seat;
  };

  if (extra.hostSeat === null) {
    return handOver(smallestSeat(present) ?? smallestSeat(seated));
  }
  if (!stillHostSeat(players, extra.hostSeat, extra.hostToken)) {
    // 离座或换了人：立即顺位（不给宽限，否则新入座者会「继承」房主）
    return handOver(smallestSeat(present) ?? smallestSeat(seated));
  }
  if (present.includes(extra.hostSeat)) {
    extra.hostAbsentSince = null;
    return extra.hostSeat;
  }
  const now = Date.now();
  if (extra.hostAbsentSince === null) extra.hostAbsentSince = now;
  if (now - extra.hostAbsentSince >= HOST_GRACE_MS) {
    return handOver(smallestSeat(present) ?? smallestSeat(seated));
  }
  return extra.hostSeat;
}

/**
 * 房间面板使用的端点：
 *   POST /new-room          生成唯一房间码
 *   GET  /room-info/:id     房间是否存在、名称、开局状态、房主、座位占用、观战者名单
 *   POST /room-name         房主改名，需房主凭据
 *   POST /room-start        房主开局：此后牌桌才对所有玩家显示，需房主凭据
 *   POST /room-host         房主把房主转给其他已入座玩家，需房主凭据
 *   POST /spectate          观战者心跳（60 秒内视为在线）
 */
function registerRoomApi(): void {
  server.router.post('/new-room', koaBody(), async (ctx) => {
    if (!rateAllow(ctx, 'new-room', 20)) return;
    const body = ctx.request.body as { name?: unknown } | undefined;
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 24) : '';
    const code = newRoomCode();
    // 房间码一发出就建档（即使还没人进入），空置回收定时器才管得到
    const extra = roomExtra(code);
    if (name !== '') extra.name = name;
    ctx.body = { roomID: code };
  });

  server.router.get('/room-info/:matchID', async (ctx) => {
    if (!rateAllow(ctx, 'room-info', 300)) return;
    const matchID = ctx.params.matchID;
    const players = await fetchSeatMeta(matchID);
    const extra = roomExtras.get(matchID);
    const seats = occupiedSeats(players);
    // 断线与托管分成两份名单：托管名单按服务器记录（与当前连接状态无关，
    // 玩家一回来就会被移出）；其余断线座位进 offline，面板显示为灰色
    const offline: string[] = [];
    const ai: string[] = [];
    for (const id of Object.keys(seats)) {
      if (extra?.presence.get(id)?.ai === true) ai.push(id);
      else if (players?.[id]?.isConnected === false) offline.push(id);
    }
    // 带 ?uid= 时告诉调用方「本 UID 在这个房间绑定的座位」（只回自己的，不泄露他人 UID）
    const uid = typeof ctx.query.uid === 'string' && uidKind(ctx.query.uid) ? ctx.query.uid : null;
    let mySeat: string | null = null;
    if (uid && extra) {
      for (const [seat, boundUid] of extra.uids) {
        // 只认自有座位键：原型链键不能出现在结果里
        if (boundUid === uid && seatMetaOf(seats, seat) !== undefined) mySeat = seat;
      }
    }
    ctx.body = {
      exists: players !== undefined,
      numPlayers: players ? Object.keys(players).length : undefined,
      name: extra?.name ?? `房间 ${matchID}`,
      started: extra?.started === true,
      /** 房内技能组（展示用）：id 为预设标识（base / 2025），未命中预设时为 null；sig 供客户端检测变化 */
      skillset: extra ? skillsetOf(extra) : { id: 'base', name: '初版', sig: loadoutSignature(LOADOUT_BASE) },
      hostSeat: players ? resolveHostSeat(matchID, players) : null,
      seats,
      // 未开局时：断线超过 1 分钟按退出房间处理；对局进行中：座位保留到本局结束
      offline,
      ai,
      /** 该 UID 在本房间绑定的座位（收回座位用）；未带 uid 或没有绑定时为 null */
      mySeat,
      // 留存期：房间信息还在、但没有在座在线的玩家（房间码仍有效，进入会重新开局）
      retained: extra !== undefined && !hasPresentSeated(players),
      spectators: activeSpectators(matchID),
    };
  });

  server.router.post('/room-name', koaBody(), async (ctx) => {
    if (!rateAllow(ctx, 'room-ops', 60)) return;
    const body = ctx.request.body as
      | { matchID?: unknown; playerID?: unknown; credentials?: unknown; name?: unknown }
      | undefined;
    const matchID = typeof body?.matchID === 'string' ? body.matchID : null;
    const playerID = typeof body?.playerID === 'string' ? body.playerID : null;
    const credentials = typeof body?.credentials === 'string' ? body.credentials : null;
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 24) : '';
    if (!matchID || !playerID || !name) {
      ctx.throw(400, 'matchID, playerID and name are required');
      return;
    }
    const players = await fetchSeatMeta(matchID);
    if (!players) {
      ctx.throw(404, `Match ${matchID} not found`);
      return;
    }
    // 只认自有座位键：__proto__ / constructor 一类原型链键读到的不是真实座位（见 seats.ts）
    const player = seatMetaOf(players, playerID);
    if (!player?.credentials || player.credentials !== credentials) {
      ctx.throw(403, 'Invalid credentials');
    }
    if (resolveHostSeat(matchID, players) !== playerID) {
      ctx.throw(403, 'Only the host can rename the room');
    }
    roomExtra(matchID).name = name;
    ctx.body = { name };
  });

  /**
   * 房主修改房间技能组（技能组方案 §8）：
   *   - 仅房主可改（凭据校验，同 /room-name）；
   *   - 对局进行中不允许修改（提示先「重开」）；
   *   - 未开局：更新房间技能组并清空当前对局数据（与 /reset-room 同款语义：房间码保留，
   *     玩家重新认领座位时由服务器按新技能组建局）。
   */
  server.router.post('/room-skills', koaBody(), async (ctx) => {
    if (!rateAllow(ctx, 'room-ops', 60)) return;
    const body = ctx.request.body as
      | { matchID?: unknown; playerID?: unknown; credentials?: unknown; loadout?: unknown }
      | undefined;
    const matchID = typeof body?.matchID === 'string' ? body.matchID : null;
    const playerID = typeof body?.playerID === 'string' ? body.playerID : null;
    const credentials = typeof body?.credentials === 'string' ? body.credentials : null;
    if (!matchID || !playerID) {
      ctx.throw(400, 'matchID and playerID are required');
      return;
    }
    const players = await fetchSeatMeta(matchID);
    if (!players) {
      ctx.throw(404, `Match ${matchID} not found`);
      return;
    }
    const player = seatMetaOf(players, playerID);
    if (!player?.credentials || player.credentials !== credentials) {
      ctx.throw(403, 'Invalid credentials');
    }
    if (resolveHostSeat(matchID, players) !== playerID) {
      ctx.throw(403, 'Only the host can change the skillset');
    }
    const extra = roomExtra(matchID);
    if (extra.started === true) {
      ctx.status = 409;
      ctx.body = { error: '对局进行中，无法修改技能组；请先「重开」' };
      return;
    }
    const invalid = validateLoadout(body?.loadout);
    if (invalid) {
      ctx.throw(400, invalid);
      return;
    }
    // 原地补写技能组（不清局、不踢人）；对局已开始 / 已有人行动时拒绝
    const patched = await patchMatchLoadout(matchID, body?.loadout as SkillLoadout);
    if (!patched) {
      ctx.status = 409;
      ctx.body = { error: '对局已开始，无法修改技能组；请先「重开」' };
      return;
    }
    extra.loadout = resolveLoadout(body?.loadout);
    ctx.body = { ok: true, skillset: skillsetOf(extra) };
  });

  server.router.post('/room-start', koaBody(), async (ctx) => {
    if (!rateAllow(ctx, 'room-ops', 60)) return;
    const body = ctx.request.body as
      | { matchID?: unknown; playerID?: unknown; credentials?: unknown }
      | undefined;
    const matchID = typeof body?.matchID === 'string' ? body.matchID : null;
    const playerID = typeof body?.playerID === 'string' ? body.playerID : null;
    const credentials = typeof body?.credentials === 'string' ? body.credentials : null;
    if (!matchID || !playerID) {
      ctx.throw(400, 'matchID and playerID are required');
      return;
    }
    const players = await fetchSeatMeta(matchID);
    if (!players) {
      ctx.throw(404, `Match ${matchID} not found`);
      return;
    }
    // 只认自有座位键：__proto__ / constructor 一类原型链键读到的不是真实座位（见 seats.ts）
    const player = seatMetaOf(players, playerID);
    if (!player?.credentials || player.credentials !== credentials) {
      ctx.throw(403, 'Invalid credentials');
    }
    if (resolveHostSeat(matchID, players) !== playerID) {
      ctx.throw(403, 'Only the host can start the game');
    }
    roomExtra(matchID).started = true;
    ctx.body = { started: true };
  });

  server.router.post('/room-host', koaBody(), async (ctx) => {
    if (!rateAllow(ctx, 'room-ops', 60)) return;
    const body = ctx.request.body as
      | { matchID?: unknown; playerID?: unknown; credentials?: unknown; targetSeat?: unknown }
      | undefined;
    const matchID = typeof body?.matchID === 'string' ? body.matchID : null;
    const playerID = typeof body?.playerID === 'string' ? body.playerID : null;
    const credentials = typeof body?.credentials === 'string' ? body.credentials : null;
    const targetSeat = typeof body?.targetSeat === 'string' ? body.targetSeat : null;
    if (!matchID || !playerID || !targetSeat) {
      ctx.throw(400, 'matchID, playerID and targetSeat are required');
      return;
    }
    const players = await fetchSeatMeta(matchID);
    if (!players) {
      ctx.throw(404, `Match ${matchID} not found`);
      return;
    }
    // 只认自有座位键：__proto__ / constructor 一类原型链键读到的不是真实座位（见 seats.ts）
    const player = seatMetaOf(players, playerID);
    if (!player?.credentials || player.credentials !== credentials) {
      ctx.throw(403, 'Invalid credentials');
    }
    if (resolveHostSeat(matchID, players) !== playerID) {
      ctx.throw(403, 'Only the host can transfer the host role');
    }
    const occupant = seatMetaOf(players, targetSeat);
    if (!occupant?.name) {
      ctx.throw(400, `Seat ${targetSeat} is not occupied`);
      return;
    }
    const extra = roomExtra(matchID);
    extra.hostSeat = targetSeat;
    // 绑定目标座位当前占者的凭据：之后该座位换人即视为房主已离开
    extra.hostToken = occupant.credentials ?? null;
    extra.hostAbsentSince = null;
    ctx.body = { hostSeat: targetSeat };
  });

  server.router.post('/spectate', koaBody(), async (ctx) => {
    if (!rateAllow(ctx, 'room-ops', 60)) return;
    const body = ctx.request.body as
      | { matchID?: unknown; spectatorID?: unknown; name?: unknown }
      | undefined;
    const matchID = typeof body?.matchID === 'string' ? body.matchID : null;
    const spectatorID = typeof body?.spectatorID === 'string' ? body.spectatorID : null;
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 24) : '';
    if (!matchID || !spectatorID || !name) {
      ctx.throw(400, 'matchID, spectatorID and name are required');
      return;
    }
    roomExtra(matchID).spectators.set(spectatorID, { name, lastSeen: Date.now() });
    ctx.body = { ok: true };
  });
}

/**
 * 账号与身份端点：
 *   POST /account/guest     新访客发一个 10 位游客 UID
 *   POST /account/register  用户名 + 密码注册，发一个 9 位专属 UID
 *   POST /account/login     登录，取回同一个 UID
 *   POST /seat-claim        用 UID 认领 / 收回座位（决策表见 seats.ts）
 *   GET  /active-game       查该 UID 是否有「进行中」的对局（客户端回主页自动拉回用）
 */
function registerAccountApi(): void {
  server.router.post('/account/guest', koaBody(), async (ctx) => {
    if (!rateAllow(ctx, 'guest', 20)) return;
    try {
      ctx.body = { uid: accounts.allocateGuestUid(), kind: 'guest' };
    } catch (error) {
      console.warn('[accounts] 游客发号失败：', error);
      ctx.throw(500, '无法分配游客 UID');
    }
  });

  const readCredentials = (ctx: { request: { body?: unknown } }) => {
    const body = ctx.request.body as { username?: unknown; password?: unknown } | undefined;
    return {
      username: typeof body?.username === 'string' ? body.username : '',
      password: typeof body?.password === 'string' ? body.password : '',
    };
  };

  server.router.post('/account/register', koaBody(), async (ctx) => {
    if (!rateAllow(ctx, 'register', 10)) return;
    const { username, password } = readCredentials(ctx);
    const result = accounts.register(username, password);
    if (!result.ok) {
      ctx.status = result.status;
      ctx.body = { error: result.error };
      return;
    }
    ctx.body = { uid: result.record.uid, username: result.record.username, kind: 'account' };
  });

  server.router.post('/account/login', koaBody(), async (ctx) => {
    if (!rateAllow(ctx, 'login', 20)) return;
    const { username, password } = readCredentials(ctx);
    const result = accounts.login(username, password);
    if (!result.ok) {
      ctx.status = result.status;
      ctx.body = { error: result.error };
      return;
    }
    ctx.body = { uid: result.record.uid, username: result.record.username, kind: 'account' };
  });

  server.router.post('/seat-claim', koaBody(), async (ctx) => {
    if (!rateAllow(ctx, 'seat-claim', 60)) return;
    const body = ctx.request.body as
      | {
          matchID?: unknown;
          playerID?: unknown;
          uid?: unknown;
          playerName?: unknown;
          credentials?: unknown;
          /** 建局参数（技能组方案 §8）：对局不存在时由服务器按房内技能组直接建局 */
          count?: unknown;
          gameName?: unknown;
        }
      | undefined;
    const matchID = typeof body?.matchID === 'string' ? body.matchID : null;
    const playerID = typeof body?.playerID === 'string' ? body.playerID : null;
    const uid = typeof body?.uid === 'string' ? body.uid : null;
    const playerName = typeof body?.playerName === 'string' ? body.playerName.trim().slice(0, 24) : '';
    const credentials = typeof body?.credentials === 'string' ? body.credentials : null;
    const count = typeof body?.count === 'number' ? body.count : null;
    const gameName = typeof body?.gameName === 'string' ? body.gameName : null;
    if (!matchID || !playerID || !uid || !uidKind(uid)) {
      ctx.throw(400, 'matchID、playerID 与合法 uid 均为必填');
      return;
    }

    let { metadata } = await server.db.fetch(matchID, { metadata: true });
    const extra = roomExtra(matchID);

    // 服务器侧建局：对局不存在且请求带了建局参数时，按房内技能组建局再认领座位
    if (!metadata && count !== null && gameName !== null) {
      const created = await createMatchWithLoadout({
        matchID,
        gameName,
        numPlayers: count,
        loadout: extra.loadout,
      });
      if (!created.ok) {
        ctx.throw(400, created.error);
        return;
      }
      ({ metadata } = await server.db.fetch(matchID, { metadata: true }));
    }

    // 兜底：对局已存在但技能组与房内不一致（如旧客户端「空连接自动建房」留下的初版对局）→
    // 原地补写技能组（不打断任何在座玩家）；补不了（对局已开始 / 已行动）就维持现状，绝不清局踢人
    if (metadata && count !== null && gameName !== null && extra.started !== true) {
      const setupLoadout = (metadata.setupData as { loadout?: SkillLoadout } | undefined)?.loadout;
      if (!sameLoadout(setupLoadout ?? LOADOUT_BASE, extra.loadout)) {
        await patchMatchLoadout(matchID, extra.loadout);
        ({ metadata } = await server.db.fetch(matchID, { metadata: true }));
      }
    }

    if (!metadata) {
      // 房间还不存在：客户端据此先建房再重试（旧客户端降级路径，所以带上 code）
      ctx.status = 404;
      ctx.body = { error: `房间 ${matchID} 还不存在`, code: 'no-match' };
      return;
    }
    const players = metadata.players as unknown as Record<string, SeatMeta>;

    const decision = decideSeatClaim({ players, uids: extra.uids, seat: playerID, uid, credentials });
    if (decision.kind === 'error') {
      ctx.status = decision.status;
      ctx.body = { error: decision.message, code: decision.code };
      return;
    }

    // decideSeatClaim 已确认 playerID 是自有座位键，这里取到的必然是真实座位条目
    const seat = seatMetaOf(players, playerID)!;
    if (decision.kind === 'occupy') {
      // 空座位入座：写名字 + 生成凭据；断线 / 托管记录归零
      seat.name = playerName || `玩家 ${Number(playerID) + 1}`;
      seat.credentials = newCredential();
      const record = seatPresence(extra, playerID);
      record.offlineSince = null;
      record.ai = false;
    }
    // 一 UID 在同一房间只绑定一个座位：清掉该 UID 的其他旧绑定
    for (const [otherSeat, boundUid] of [...extra.uids]) {
      if (boundUid === uid && otherSeat !== playerID) extra.uids.delete(otherSeat);
    }
    extra.uids.set(playerID, uid);
    await server.db.setMetadata(matchID, metadata);
    ctx.body = { playerID, playerCredentials: seat.credentials, name: seat.name };
  });

  server.router.get('/active-game', async (ctx) => {
    if (!rateAllow(ctx, 'active-game', 60)) return;
    const uid = typeof ctx.query.uid === 'string' ? ctx.query.uid : '';
    if (!uidKind(uid)) {
      ctx.throw(400, 'uid 非法');
      return;
    }
    const matchIDs = await server.db.listMatches();
    const candidates: {
      room: string;
      gameName: string;
      seat: string;
      numPlayers: number;
      name: string;
      updatedAt: number;
    }[] = [];
    for (const matchID of matchIDs) {
      const extra = roomExtras.get(matchID);
      if (!extra) continue; // 不是本服务器的房间（或已销毁）
      const { metadata, state } = await server.db.fetch(matchID, { metadata: true, state: true });
      if (!metadata) continue;
      // 只拉「已开局且未结束」的对局；等待开局 / 已结束的不算「未完成的对局」
      if (!isGameInProgress(extra, state as unknown as MasterState | undefined)) continue;
      const players = metadata.players as unknown as Record<string, SeatMeta>;
      for (const [seat, boundUid] of extra.uids) {
        // 只认自有座位键（绑定表里的键同样按此校验，避免读到原型链上的值）
        const occupant = seatMetaOf(players, seat);
        if (boundUid !== uid || !occupant?.name) continue;
        candidates.push({
          room: matchID,
          gameName: metadata.gameName,
          seat,
          numPlayers: Object.keys(players).length,
          name: occupant.name,
          updatedAt: metadata.updatedAt,
        });
      }
    }
    ctx.body = { game: pickLatestGame(candidates) };
  });
}

/** 房间已空且没有对局：复位开局状态、房主、在线记录与 UID 绑定（等人回来按规则重新推得房主） */
function resetEmptyRoomState(extra: ReturnType<typeof roomExtra>): void {
  extra.started = false;
  extra.hostSeat = null;
  extra.hostToken = null;
  extra.hostAbsentSince = null;
  extra.presence.clear();
  extra.uids.clear();
}

/** 动作转成 boardgame.io 的载荷（动作名与参数与 src/client/game.ts 注册的 move 一一对应） */
function movePayload(move: Move): { type: string; args: unknown[] } {
  switch (move.type) {
    case 'passCoin':
      return { type: 'passCoin', args: [move.to] };
    case 'resolveMagicTargets':
      return { type: 'resolveMagicTargets', args: [move.targets] };
    case 'chooseGoLast':
      return { type: 'chooseGoLast', args: [] };
    case 'playCard':
      return { type: 'playCard', args: [move.cardId] };
    case 'playRandom':
      return { type: 'playRandom', args: [] };
    case 'passTurn':
      return { type: 'passTurn', args: [] };
    case 'pickPreShuffleTarget':
      return { type: 'pickPreShuffleTarget', args: [move.targetId] };
    case 'resolveRedraw':
      return { type: 'resolveRedraw', args: move.targetId ? [move.targetId] : [] };
  }
}

/**
 * 以某个座位的身份提交一个动作：直接发 socket.io 的 update 事件（与客户端同一条通道）。
 *
 * 只发动作、不做 sync，因此服务器不会把该座位标记为「已连接」——
 * AI 自身代打不会把 `isConnected` 翻成 true，玩家的在线状态与归来判定都不受干扰。
 */
function submitMove(opts: {
  gameName: string;
  matchID: string;
  seat: string;
  credentials: string;
  stateID: number;
  move: Move;
}): Promise<void> {
  return new Promise((resolve) => {
    const action = {
      type: 'MAKE_MOVE',
      payload: { ...movePayload(opts.move), playerID: opts.seat, credentials: opts.credentials },
    };
    const socket = io(`http://localhost:${PORT}/${opts.gameName}`, {
      reconnection: false,
      timeout: 2000,
    });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      socket.close();
      resolve();
    };
    socket.on('connect', () => {
      socket.emit('update', action, opts.stateID, opts.matchID, opts.seat);
      setTimeout(finish, 150); // 留一点时间让服务器把动作落盘
    });
    socket.on('connect_error', finish);
    setTimeout(finish, 3000); // 兜底：服务器不可达时不让巡检卡住
  });
}

/** 在托管座位里找出当前该行动的那位，并给出它的动作（没有则返回 null） */
function aiSeatMove(
  extra: ReturnType<typeof roomExtra>,
  players: Record<string, SeatMeta>,
  master: MasterState,
): { seat: string; move: Move } | null {
  const G = master.G;
  if (!G) return null;
  for (const [seat, record] of extra.presence) {
    if (!record.ai || !players[seat]?.name) continue;
    const move = autoMoveFor(G, seat);
    if (move) return { seat, move };
  }
  return null;
}

/**
 * AI 托管代打：对局进行中，被托管的座位轮到自己决策时代操作。
 * 一趟巡检最多连打 MAX_AI_ACTIONS_PER_SWEEP 个动作——一个动作经常把阶段推进给下一个托管座位；
 * 动作提交后重新取一次状态，若状态没有前进（动作被拒 / 状态已变）就留给下一趟巡检重试。
 */
async function runAiTakeover(
  matchID: string,
  extra: ReturnType<typeof roomExtra>,
  players: Record<string, SeatMeta>,
  master: MasterState,
  gameName: string,
): Promise<void> {
  let current = master;
  for (let step = 0; step < MAX_AI_ACTIONS_PER_SWEEP; step++) {
    const act = aiSeatMove(extra, players, current);
    if (!act) return;
    const credentials = players[act.seat]?.credentials;
    if (!credentials) return;
    const stateID = current._stateID ?? 0;
    await submitMove({ gameName, matchID, seat: act.seat, credentials, stateID, move: act.move });
    const next = await fetchMasterState(matchID);
    if (next === undefined || next._stateID === stateID) {
      console.warn(`房间 ${matchID} 座位 ${Number(act.seat) + 1} 的 AI 托管动作未生效（状态已变化），下一趟巡检重试`);
      return;
    }
    current = next;
  }
}

/**
 * 房间巡检定时器（服务器后台，不依赖客户端在线）：
 *   1. 在线状态：维护每个座位的断线记录；对局进行中断线超过 AI_TAKEOVER_MS → 标记 AI 托管，
 *      玩家一回来（巡检看到在线）→ 立即撤销托管；
 *   2. 断线处理：**仅未开局 / 对局已结束**时按 OFFLINE_LEAVE_MS 释放座位（清掉名字与凭据；
 *      若房里因此再没有在座玩家，连对局一起清掉）。对局进行中座位一直保留到本局结束；
 *   3. 空房间留存：没有任何「在座且在线」玩家 → 记为空置（emptySince），留存 RETAIN_EMPTY_MS；
 *      期间有人入座 / 连回来 → 清零；期满仍无人 → 销毁房间（清掉对局与房间信息，房间码失效）。
 *      对局进行中暂停销毁：全员暂时断线也会等玩家回来（AI 会继续代打）。
 *   4. AI 托管代打：对局进行中，托管座位轮到自己决定时由服务器代操作（见 runAiTakeover）。
 * 房里已无对局（如全员断线被释放、房主重开后没回来）时，顺手复位开局状态与房主，等人回来重新推得。
 */
function watchRooms(): void {
  setInterval(async () => {
    for (const [matchID, extra] of [...roomExtras]) {
      const now = Date.now();
      const { metadata, state } = await server.db.fetch(matchID, { metadata: true, state: true });
      let players = metadata?.players as unknown as Record<string, SeatMeta> | undefined;
      const master = state as unknown as MasterState | undefined;
      const inProgress = isGameInProgress(extra, master);

      // 1) 在线状态：断线记录与 AI 托管标记
      if (players) {
        for (const [seat, meta] of Object.entries(players)) {
          if (!meta?.name) continue;
          const record = seatPresence(extra, seat);
          if (meta.isConnected === false) {
            record.offlineSince ??= now;
            if (inProgress && !record.ai && now - record.offlineSince >= AI_TAKEOVER_MS) {
              record.ai = true;
              console.log(
                `房间 ${matchID} 座位 ${Number(seat) + 1} 断线超过 ${AI_TAKEOVER_MS / 60_000} 分钟，由 AI 暂时托管（出牌跳过、技能随机选人）`,
              );
            }
            continue;
          }
          // 看到在线信号就是本人回来了：AI 代打只发动作、不做 sync，不会把 isConnected 翻成 true，
          // 因此这里不需要额外的连续确认。
          if (record.offlineSince !== null) {
            record.offlineSince = null;
            if (record.ai) {
              record.ai = false;
              console.log(`房间 ${matchID} 座位 ${Number(seat) + 1} 的玩家已回来，AI 托管结束`);
            }
          }
        }
        // 清理已离座座位的记录
        for (const seat of [...extra.presence.keys()]) {
          if (!players[seat]?.name) extra.presence.delete(seat);
        }
      }

      // 2) 断线超时 → 按退出房间处理（仅未开局 / 对局已结束时；对局进行中保留座位到本局结束）
      if (players && metadata && !inProgress) {
        const freed: string[] = [];
        for (const [seat, meta] of Object.entries(players)) {
          if (!meta?.name || meta.isConnected !== false) continue;
          const since = extra.presence.get(seat)?.offlineSince ?? null;
          if (since === null || now - since < OFFLINE_LEAVE_MS) continue;
          delete meta.name;
          delete meta.credentials;
          delete meta.isConnected; // 座位彻底腾空：新入座者不会继承「断线」标记
          extra.presence.delete(seat);
          extra.uids.delete(seat); // UID 绑定随座位释放一起清除
          freed.push(seat);
        }
        if (freed.length > 0) {
          const anyNamed = Object.values(players).some((player) => player?.name);
          if (anyNamed) await server.db.setMetadata(matchID, metadata);
          else {
            await server.db.wipe(matchID);
            players = undefined;
          }
          if (!players) resetEmptyRoomState(extra);
          console.log(
            `房间 ${matchID} 座位 ${freed.map((seat) => Number(seat) + 1).join('、')} 断线超过 ${OFFLINE_LEAVE_MS / 1000} 秒，已按退出房间处理`,
          );
        }
      }

      // 3) 空房间留存与到期销毁
      if (inProgress) {
        extra.emptySince = null; // 对局进行中：等玩家回来，不销毁
      } else if (hasPresentSeated(players)) {
        extra.emptySince = null;
      } else {
        if (extra.emptySince === null) {
          extra.emptySince = now;
          console.log(`房间 ${matchID} 已空置，留存 ${RETAIN_EMPTY_MS / 1000} 秒等待重新进入`);
        }
        // 房里已无对局（如全员断线被释放、房主重开后没回来）：复位开局状态与房主，等人回来重新推得
        if (!players) resetEmptyRoomState(extra);
        if (now - extra.emptySince >= RETAIN_EMPTY_MS) {
          roomExtras.delete(matchID);
          if (players) await server.db.wipe(matchID);
          console.log(`房间 ${matchID} 空置超过 ${RETAIN_EMPTY_MS / 1000} 秒，已销毁（房间码失效）`);
          continue;
        }
      }

      // 4) AI 托管代打
      if (inProgress && players && metadata) {
        await runAiTakeover(matchID, extra, players, master!, metadata.gameName);
      }
    }
  }, EMPTY_SWEEP_MS);
}

server
  .run(PORT, () => {
    console.log(`房间服务器已启动：http://localhost:${PORT}（已注册 ${games.length} 个配比变体）`);
    console.log('测试者使用相同 room、相同人数与配比、不同 seat 即可进入同一局。');
  })
  .then(() => {
    const loaded = accounts.load();
    console.log(
      `账号表已加载：${accounts.path}（专属账号 ${accounts.accountCount} 个${loaded.warning ? `；${loaded.warning}` : ''}）`,
    );
    registerResetRoom();
    registerRoomApi();
    registerAccountApi();
    registerStaticSite();
    watchRooms();
  })
  .catch((error) => {
    console.error(`房间服务器启动失败（端口 ${PORT} 可能被占用）：`, error);
    process.exitCode = 1;
  });