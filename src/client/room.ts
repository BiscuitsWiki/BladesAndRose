/**
 * 联机房间的凭据、席位与观战流程。
 *
 * 认证走 boardgame.io 的 lobby 接口：
 *   - `join` 由玩家自己调用，服务器为该座位生成 playerCredentials 并写入房间元数据；
 *     一旦房间里有任意玩家带凭据，之后所有连接与动作都必须携带与座位匹配的凭据，
 *     因此冒用他人座位会被服务器拒绝。
 *   - 凭据按 (game, 房间, 座位) 存在浏览器 localStorage，刷新 / 重连直接复用。
 *   - 座位上已有名字时 join 返回 409：本地有凭据说明是自己此前加入的（视为重连），
 *     否则提示换一个座位。
 *
 * 有了玩家 UID（见 account.ts）后，带 uid 的入座改走自定义端点 `/seat-claim`：
 * 服务器按「座位 → UID」绑定判定能否入座，并保证带自己的 UID 能收回自己的座位
 * （即便本机凭据丢了）；不带 uid 时保持原来的内置 join 流程（降级路径）。
 *
 * 房间层面的其余信息（房间码、房间名、开局状态、房主、座位占用、观战者）走开发服务器的自定义端点，
 * 见 src/server/dev-server.ts 的 registerRoomApi。房主与座位号无关：创建者即房主，可转移；
 * 房主离座 / 断线超过宽限期未回来时，服务器顺位给最小已入座座位。
 */
import { Client } from 'boardgame.io/client';
import { SocketIO } from 'boardgame.io/multiplayer';
import type { Distribution, SkillLoadout } from '../engine';
import { gameNameOf, getBladesAndRose } from './game';

/** 与 src/server/dev-server.ts 的 PORT 保持一致（仅开发模式使用） */
export const ROOM_SERVER_PORT = 8000;

/**
 * 房间服务器地址：
 *   - 生产构建：前端与房间服务器由同一个进程托管（同源），直接用当前页面 origin
 *     （协议 / 主机 / 端口自动对齐，HTTPS 时无需任何改动，也不存在 CORS）；
 *   - 开发模式：vite 在 5173、房间服务器在 8000，按当前主机名拼出服务器地址
 *     （便于手机经局域网 IP 访问时自动对齐）。
 */
export function serverBase(): string {
  if (import.meta.env.PROD) return window.location.origin;
  return `http://${window.location.hostname}:${ROOM_SERVER_PORT}`;
}

// ---------------------------------------------------------------- 本地存储

function credentialKey(gameName: string, room: string, seat: string): string {
  return `blades-and-rose:creds:${gameName}:${room}:${seat}`;
}

/** 读取本地保存的座位凭据；没有或不可用（如隐私模式）时返回 null */
export function loadCredentials(gameName: string, room: string, seat: string): string | null {
  try {
    return window.localStorage.getItem(credentialKey(gameName, room, seat));
  } catch {
    return null;
  }
}

function saveCredentials(gameName: string, room: string, seat: string, value: string): void {
  try {
    window.localStorage.setItem(credentialKey(gameName, room, seat), value);
  } catch {
    // 写不进去时本次会话仍可用，只是刷新后需要重新加入
  }
}

function clearCredentials(gameName: string, room: string, seat: string): void {
  try {
    window.localStorage.removeItem(credentialKey(gameName, room, seat));
  } catch {
    // 忽略
  }
}

/** 玩家昵称（跨房间复用） */
export function loadNickname(): string {
  try {
    return window.localStorage.getItem('blades-and-rose:nickname') ?? '';
  } catch {
    return '';
  }
}

export function saveNickname(name: string): void {
  try {
    window.localStorage.setItem('blades-and-rose:nickname', name);
  } catch {
    // 忽略
  }
}

/** 观战者标识（本机持久，用于观战席心跳） */
export function spectatorId(): string {
  const key = 'blades-and-rose:spectator-id';
  try {
    let id = window.localStorage.getItem(key);
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      window.localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

// ---------------------------------------------------------------- HTTP 工具

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface RoomInfo {
  /** 房间是否已在服务器上创建 */
  exists: boolean;
  /** 房间人数（建房时确定）；房间不存在时为 undefined */
  numPlayers?: number;
  name: string;
  /** 是否已开局：房主点「开始游戏」后为 true，此前界面只显示座位面板 */
  started: boolean;
  /** 房内技能组（展示用）：id 为预设标识（base / 2025），未命中预设时为 null；sig 为技能组签名（客户端据此检测变化后重连刷新） */
  skillset: { id: string | null; name: string; sig?: string };
  /** 当前房主的座位号；null = 尚未推得（新房间 / 刚重开）。房主与座位号无关，只是恰好坐在某个座位上 */
  hostSeat: string | null;
  /** 留存期：房间信息还在但没有在座在线的玩家。房间码仍有效——进入会重新开局，第一位入座者成为房主 */
  retained: boolean;
  /** 座位号 → 昵称（已占用的座位） */
  seats: Record<string, string>;
  /**
   * 断线中的座位号（名字还在、连接掉了，且尚未托管）：未开局时超过 1 分钟按退出处理，
   * 对局进行中座位保留到本局结束。面板显示为灰色。
   */
  offline: string[];
  /** AI 托管中的座位号（对局进行中断线超过 3 分钟）：服务器代打，出牌跳过、技能随机选人；本人回来自动恢复 */
  ai: string[];
  /** 带 uid 查询时：该 UID 在本房间绑定的座位（收回座位用）；未带 uid 或没有绑定时为 null */
  mySeat: string | null;
  /** 观战者昵称（最近有心跳的） */
  spectators: string[];
}

/** 创建房间：房间号由系统随机生成（不可编辑）；name 为可选的房间名称 */
export async function newRoomCode(name?: string): Promise<string> {
  const response = await postJson(`${serverBase()}/new-room`, { name: name ?? '' });
  if (!response.ok) throw new Error('无法创建房间（房间服务器不可用？）');
  const data = (await response.json()) as { roomID?: string };
  if (!data.roomID) throw new Error('服务器未返回房间码');
  return data.roomID;
}

/** 读取房间信息（是否存在、名称、座位占用、观战者）；带 uid 时可拿到「本 UID 绑定的座位」 */
export async function fetchRoomInfo(room: string, uid?: string | null): Promise<RoomInfo> {
  const query = uid ? `?uid=${encodeURIComponent(uid)}` : '';
  const response = await fetch(`${serverBase()}/room-info/${encodeURIComponent(room)}${query}`);
  if (!response.ok) throw new Error(`获取房间信息失败（HTTP ${response.status}）`);
  return (await response.json()) as RoomInfo;
}

/** 该 UID 进行中的对局（回主页自动拉回用）；服务器只返回「已开局且未结束」的一局 */
export interface ActiveGame {
  /** 房间号（matchID） */
  room: string;
  /** game 变体名（含配比签名）：客户端据此反解配比、选择同一个 game */
  gameName: string;
  seat: string;
  numPlayers: number;
  /** 该座位上的显示名 */
  name: string;
  updatedAt: number;
}

/** 查询该 UID 有没有进行中的对局；没有则返回 null */
export async function fetchActiveGame(uid: string): Promise<ActiveGame | null> {
  const response = await fetch(`${serverBase()}/active-game?uid=${encodeURIComponent(uid)}`);
  if (!response.ok) throw new Error(`查询进行中的对局失败（HTTP ${response.status}）`);
  const data = (await response.json()) as { game?: ActiveGame | null };
  return data.game ?? null;
}

/** 一次认领请求的结果：no-match 表示房间还不存在（调用方先建房再重试） */
type ClaimOutcome =
  | { kind: 'claimed'; credentials: string }
  | { kind: 'no-match' }
  | { kind: 'conflict'; message: string }
  | { kind: 'error'; message: string };

/** 用 UID 认领座位的单次请求（不带建房重试） */
async function claimSeatOnce(opts: {
  room: string;
  seat: string;
  uid: string;
  playerName: string;
  credentials: string | null;
  /** 对局不存在时，服务器按这两个参数与房内技能组建局（见 dev-server 的 /seat-claim） */
  count: number;
  gameName: string;
}): Promise<ClaimOutcome> {
  let response: Response;
  try {
    response = await postJson(`${serverBase()}/seat-claim`, {
      matchID: opts.room,
      playerID: opts.seat,
      uid: opts.uid,
      playerName: opts.playerName,
      credentials: opts.credentials ?? undefined,
      count: opts.count,
      gameName: opts.gameName,
    });
  } catch {
    return { kind: 'error', message: '连接房间服务器失败，请确认已运行 npm run dev:server' };
  }
  const data = (await response.json().catch(() => null)) as
    | { playerCredentials?: string; error?: string; code?: string }
    | null;
  if (response.status === 404 && data?.code === 'no-match') return { kind: 'no-match' };
  if (response.status === 403 || response.status === 409) {
    return { kind: 'conflict', message: data?.error ?? `座位 ${Number(opts.seat) + 1} 已被占用` };
  }
  if (!response.ok) {
    return { kind: 'error', message: data?.error ?? `认领座位失败（HTTP ${response.status}）` };
  }
  if (!data?.playerCredentials) return { kind: 'error', message: '服务器未返回座位凭据' };
  return { kind: 'claimed', credentials: data.playerCredentials };
}

/**
 * 用 UID 认领 / 收回自己的座位（大厅进入、回主页拉回、自动归位都用它）：
 * 服务器按绑定判定，成功后返回并保存该座位的凭据；房间不存在时先自动建房再认领一次。
 */
export async function claimSeat(opts: {
  room: string;
  seat: string;
  uid: string;
  playerName: string;
  override: Partial<Distribution> | null;
  count: number;
}): Promise<string> {
  const gameName = gameNameOf(opts.override);
  const existing = loadCredentials(gameName, opts.room, opts.seat);
  let outcome = await claimSeatOnce({ ...opts, credentials: existing, gameName });
  if (outcome.kind === 'no-match') {
    await createRoom(opts.room, opts.count, opts.override);
    outcome = await claimSeatOnce({ ...opts, credentials: existing, gameName });
  }
  if (outcome.kind === 'claimed') {
    saveCredentials(gameName, opts.room, opts.seat, outcome.credentials);
    return outcome.credentials;
  }
  throw new Error(outcome.kind === 'no-match' ? '房间创建失败，请重试' : outcome.message);
}

/** 房主修改房间名 */
export async function renameRoom(opts: {
  room: string;
  seat: string;
  credentials: string;
  name: string;
}): Promise<void> {
  const response = await postJson(`${serverBase()}/room-name`, {
    matchID: opts.room,
    playerID: opts.seat,
    credentials: opts.credentials,
    name: opts.name,
  });
  if (!response.ok) throw new Error(`修改房间名失败（HTTP ${response.status}）`);
}

/**
 * 房主修改房间技能组：仅房主、仅未开局可用（对局中请先「重开」）。
 * 修改会清空当前等待中的对局数据，玩家刷新重进即按新技能组重建对局。
 */
export async function setRoomSkills(opts: {
  room: string;
  seat: string;
  credentials: string;
  loadout: SkillLoadout;
}): Promise<void> {
  const response = await postJson(`${serverBase()}/room-skills`, {
    matchID: opts.room,
    playerID: opts.seat,
    credentials: opts.credentials,
    loadout: opts.loadout,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `修改技能组失败（HTTP ${response.status}）`);
  }
}

/** 房主开局：服务器置 `started` 后，各客户端轮询到才显示牌桌 */
export async function startRoom(opts: {
  room: string;
  seat: string;
  credentials: string;
}): Promise<void> {
  const response = await postJson(`${serverBase()}/room-start`, {
    matchID: opts.room,
    playerID: opts.seat,
    credentials: opts.credentials,
  });
  if (!response.ok) throw new Error(`开始游戏失败（HTTP ${response.status}）`);
}

/**
 * 转移房主：房主把自己（当前座位 + 凭据）的房主身份转给 targetSeat。
 * 显式「转移房主」与房主换座走同一个端点——换座时先用旧座位凭据把房主带到新座位，再离座。
 */
export async function transferHost(opts: {
  room: string;
  seat: string;
  credentials: string;
  targetSeat: string;
}): Promise<void> {
  const response = await postJson(`${serverBase()}/room-host`, {
    matchID: opts.room,
    playerID: opts.seat,
    credentials: opts.credentials,
    targetSeat: opts.targetSeat,
  });
  if (!response.ok) throw new Error(`转移房主失败（HTTP ${response.status}）`);
}

/** 观战心跳：停留在观战席期间定期调用，让房间面板显示自己在看 */
export async function spectateHeartbeat(room: string, name: string): Promise<void> {
  await postJson(`${serverBase()}/spectate`, {
    matchID: room,
    spectatorID: spectatorId(),
    name,
  });
}

// ---------------------------------------------------------------- 席位

/**
 * 房间不存在时先建房：用一次不带凭据的连接触发服务器自动创建（与自动建房语义一致），
 * 随后立刻断开，再走 join 流程。
 */
export function createRoom(
  room: string,
  count: number,
  override: Partial<Distribution> | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = Client({
      game: getBladesAndRose(override),
      numPlayers: count,
      multiplayer: SocketIO({ server: serverBase() }),
      playerID: '0',
      matchID: room,
    });
    const timer = window.setTimeout(() => {
      client.stop();
      reject(new Error('连接房间服务器超时，请确认已运行 npm run dev:server'));
    }, 5000);
    const check = () => {
      if (client.getState() !== null) {
        window.clearTimeout(timer);
        client.stop();
        resolve();
      } else {
        window.setTimeout(check, 50);
      }
    };
    client.start();
    check();
  });
}

export interface JoinOptions {
  room: string;
  seat: string;
  count: number;
  override: Partial<Distribution> | null;
  nickname: string;
  /** 玩家 UID：带 uid 时走 /seat-claim（可凭 UID 收回自己的座位）；不带则走内置 join（降级路径） */
  uid?: string | null;
}

/** 加入某个座位并返回该座位的凭据（必要时先建房、或复用本地凭据） */
export async function joinRoom({
  room,
  seat,
  count,
  override,
  nickname,
  uid,
}: JoinOptions): Promise<string> {
  const gameName = gameNameOf(override);

  // 有 UID：走 /seat-claim —— 服务器按「座位 → UID」绑定判定，能收回自己的座位
  if (uid) {
    const existing = loadCredentials(gameName, room, seat);
    let outcome = await claimSeatOnce({ room, seat, uid, playerName: nickname, credentials: existing, count, gameName });
    if (outcome.kind === 'no-match') {
      await createRoom(room, count, override);
      outcome = await claimSeatOnce({ room, seat, uid, playerName: nickname, credentials: existing, count, gameName });
    }
    if (outcome.kind === 'claimed') {
      saveCredentials(gameName, room, seat, outcome.credentials);
      return outcome.credentials;
    }
    if (outcome.kind === 'conflict' && existing) return existing; // 自己此前加入过：视为重连
    throw new Error(outcome.kind === 'no-match' ? '房间创建失败，请重试' : outcome.message);
  }

  const joinUrl = `${serverBase()}/games/${encodeURIComponent(gameName)}/${encodeURIComponent(room)}/join`;
  const joinBody = { playerID: seat, playerName: nickname };

  let response = await postJson(joinUrl, joinBody);
  if (response.status === 404) {
    await createRoom(room, count, override);
    response = await postJson(joinUrl, joinBody);
  }
  if (response.status === 409) {
    const existing = loadCredentials(gameName, room, seat);
    if (existing) return existing; // 自己此前加入过：视为重连
    throw new Error(`座位 ${Number(seat) + 1} 已被占用，请换一个座位`);
  }
  if (!response.ok) {
    throw new Error(`加入座位失败（HTTP ${response.status}）`);
  }
  const data = (await response.json()) as { playerCredentials?: string };
  if (!data.playerCredentials) throw new Error('服务器未返回座位凭据');
  saveCredentials(gameName, room, seat, data.playerCredentials);
  return data.playerCredentials;
}

/** 离座（换座或腾出座位给观战者）：释放该座位的名字与凭据 */
export async function leaveSeat(opts: {
  room: string;
  seat: string;
  override: Partial<Distribution> | null;
  credentials: string;
}): Promise<void> {
  const gameName = gameNameOf(opts.override);
  const response = await postJson(
    `${serverBase()}/games/${encodeURIComponent(gameName)}/${encodeURIComponent(opts.room)}/leave`,
    { playerID: opts.seat, credentials: opts.credentials },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`离开座位失败（HTTP ${response.status}）`);
  }
  clearCredentials(gameName, opts.room, opts.seat);
}

/** 房主重置房间：凭据经服务器校验后删除整个房间（供「重开」使用） */
export async function resetRoom(opts: {
  room: string;
  seat: string;
  override: Partial<Distribution> | null;
  credentials: string;
}): Promise<void> {
  const response = await postJson(`${serverBase()}/reset-room`, {
    matchID: opts.room,
    playerID: opts.seat,
    credentials: opts.credentials,
  });
  if (!response.ok) {
    throw new Error(`重置房间失败（HTTP ${response.status}）`);
  }
}