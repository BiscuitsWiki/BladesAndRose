/**
 * 玩家账号（UID 身份）。
 *
 * 系统为每位玩家发放唯一 UID，玩家身份以 UID 为准（昵称只是显示名）：
 *   - 游客（临时账号）：10 位，访问即自动发放，存本机；
 *   - 专属账号（需注册）：9 位，用户名 + 密码注册 / 登录后取回同一个 UID。
 *
 * 本文件负责：本机身份缓存（localStorage）、申请游客号、注册与登录。
 * 「用 UID 收回座位」「回到主页自动拉回对局」在 room.ts / App.tsx 里完成。
 */
import { serverBase } from './room';

// ---------------------------------------------------------------- 纯函数（便于单测）

/** 与服务端 src/server/accounts.ts 保持同一套区间规则 */
const DEV_UID_MIN = 10_000_000;
const DEV_UID_MAX = 99_999_999;
const ACCOUNT_UID_MIN = 100_000_000;
const ACCOUNT_UID_MAX = 999_999_999;
const GUEST_UID_MIN = 1_000_000_000;
const GUEST_UID_MAX = 9_999_999_999;

export type AccountKind = 'dev' | 'account' | 'guest';

export interface LocalAccount {
  uid: string;
  kind: AccountKind;
  /** 专属账号 / 开发者账号的用户名（游客没有） */
  username?: string;
}

/** 判 UID 类型（与服务端同规则）：不规范（脏串 / 前导零）或越界返回 null */
export function uidKindOf(uid: string): AccountKind | null {
  if (!/^\d+$/.test(uid)) return null;
  const value = Number(uid);
  if (String(value) !== uid) return null;
  if (value >= DEV_UID_MIN && value <= DEV_UID_MAX) return 'dev';
  if (value >= ACCOUNT_UID_MIN && value <= ACCOUNT_UID_MAX) return 'account';
  if (value >= GUEST_UID_MIN && value <= GUEST_UID_MAX) return 'guest';
  return null;
}

/** 界面身份说明：「开发者账号「Alice」· UID 12345678」/「专属账号「Alice」· UID 123456789」/「游客 · UID 1000000001」 */
export function uidLabel(account: LocalAccount): string {
  if (account.kind === 'dev') {
    return `开发者账号「${account.username ?? ''}」· UID ${account.uid}`;
  }
  if (account.kind === 'account') {
    return `专属账号「${account.username ?? ''}」· UID ${account.uid}`;
  }
  return `游客 · UID ${account.uid}`;
}

// ---------------------------------------------------------------- 本机身份缓存

const ACCOUNT_KEY = 'blades-and-rose:account';

/** 读取本机身份；没有或不可用（隐私模式 / 数据被清）时返回 null */
export function loadAccount(): LocalAccount | null {
  try {
    const text = window.localStorage.getItem(ACCOUNT_KEY);
    if (!text) return null;
    const parsed = JSON.parse(text) as Partial<LocalAccount>;
    if (typeof parsed.uid !== 'string') return null;
    const kind = uidKindOf(parsed.uid);
    if (!kind) return null;
    return {
      uid: parsed.uid,
      kind,
      username: typeof parsed.username === 'string' ? parsed.username : undefined,
    };
  } catch {
    return null;
  }
}

export function saveAccount(account: LocalAccount): void {
  try {
    window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    // 写不进去时本次会话仍可用，只是刷新后要重新登录 / 换新游客号
  }
}

/** 退出登录：只清本机身份，服务器上的账号与座位绑定都不动 */
export function clearAccount(): void {
  try {
    window.localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // 忽略
  }
}

// ---------------------------------------------------------------- 开发者授权（解锁本地热座调试）

/** 服务器签发的开发者授权：token 存本机，7 天过期，可随时登出 / 吊销 */
export interface DevToken {
  token: string;
  /** 该授权对应的开发者 UID */
  uid: string;
  /** 过期时刻（epoch ms） */
  expiresAt: number;
}

const DEV_TOKEN_KEY = 'blades-and-rose:dev-token';

/** 解析本机保存的授权文本（纯函数，便于单测）：缺失、损坏或已过期返回 null */
export function parseDevToken(text: string | null, now: number): DevToken | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<DevToken>;
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.uid !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return null;
    }
    if (parsed.expiresAt <= now) return null;
    return { token: parsed.token, uid: parsed.uid, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

/** 读取本机开发者授权；缺失、损坏或已过期返回 null（过期顺手清除） */
export function loadDevToken(): DevToken | null {
  let text: string | null = null;
  try {
    text = window.localStorage.getItem(DEV_TOKEN_KEY);
  } catch {
    return null;
  }
  const parsed = parseDevToken(text, Date.now());
  if (text !== null && parsed === null) clearDevToken();
  return parsed;
}

export function saveDevToken(value: DevToken): void {
  try {
    window.localStorage.setItem(DEV_TOKEN_KEY, JSON.stringify(value));
  } catch {
    // 写不进去时本次会话仍可用，刷新后需重新登录开发者账号
  }
}

export function clearDevToken(): void {
  try {
    window.localStorage.removeItem(DEV_TOKEN_KEY);
  } catch {
    // 忽略
  }
}

// ---------------------------------------------------------------- HTTP

async function postAccount(path: string, body: unknown): Promise<LocalAccount> {
  let response: Response;
  try {
    response = await fetch(`${serverBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('连接账号服务器失败，请确认已运行 npm run dev:server');
  }
  const data = (await response.json().catch(() => null)) as
    | { uid?: string; username?: string; error?: string; token?: string; expiresAt?: number }
    | null;
  if (!response.ok) throw new Error(data?.error ?? `账号操作失败（HTTP ${response.status}）`);
  if (!data?.uid) throw new Error('服务器未返回 UID');
  const kind = uidKindOf(data.uid);
  if (!kind) throw new Error('服务器返回的 UID 不合法');
  const account: LocalAccount = {
    uid: data.uid,
    kind,
    username: typeof data.username === 'string' ? data.username : undefined,
  };
  saveAccount(account);
  // dev 账号：顺带保存解锁热座调试的授权
  if (kind === 'dev' && typeof data.token === 'string' && typeof data.expiresAt === 'number') {
    saveDevToken({ token: data.token, uid: data.uid, expiresAt: data.expiresAt });
  }
  return account;
}

/** 保证本机有可用身份：本地已有直接用；没有就申请一个 10 位游客 UID 并存下来 */
export async function ensureGuestAccount(): Promise<LocalAccount> {
  const existing = loadAccount();
  if (existing) return existing;
  return postAccount('/account/guest', {});
}

/** 注册专属账号（用户名 + 密码），成功后本机身份切换为该账号的 9 位 UID */
export async function registerAccount(username: string, password: string): Promise<LocalAccount> {
  return postAccount('/account/register', { username, password });
}

/** 登录：取回该账号原来的 9 位 UID（dev 账号为 8 位 UID，响应附带解锁热座的授权） */
export async function loginAccount(username: string, password: string): Promise<LocalAccount> {
  return postAccount('/account/login', { username, password });
}

/** 邀请码注册开发者账号：第三类身份（8 位 UID），可入座玩联机并解锁本地热座调试 */
export async function devRegister(
  invite: string,
  username: string,
  password: string,
): Promise<LocalAccount> {
  return postAccount('/account/dev-register', { invite, username, password });
}

/** 用本机保存的授权向服务器复核（过期 / 吊销 / 删号则清除并返回 false） */
export async function devCheck(): Promise<boolean> {
  const saved = loadDevToken();
  if (!saved) return false;
  let response: Response;
  try {
    response = await fetch(`${serverBase()}/account/dev-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: saved.token }),
    });
  } catch {
    return false; // 服务器不可用：本次不解锁，本地授权保留待下次复核
  }
  if (response.ok) return true;
  clearDevToken();
  return false;
}

/** 登出开发者授权：清除本机授权并通知服务器吊销（失败不阻断本地清理） */
export async function devLogout(): Promise<void> {
  const saved = loadDevToken();
  clearDevToken();
  if (!saved) return;
  try {
    await fetch(`${serverBase()}/account/dev-logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: saved.token }),
    });
  } catch {
    // 忽略：本地已清除，服务器侧 token 到期自动失效
  }
}