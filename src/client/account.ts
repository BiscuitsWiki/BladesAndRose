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
const ACCOUNT_UID_MIN = 100_000_000;
const ACCOUNT_UID_MAX = 999_999_999;
const GUEST_UID_MIN = 1_000_000_000;
const GUEST_UID_MAX = 9_999_999_999;

export type AccountKind = 'account' | 'guest';

export interface LocalAccount {
  uid: string;
  kind: AccountKind;
  /** 专属账号的用户名（游客没有） */
  username?: string;
}

/** 判 UID 类型（与服务端同规则）：不规范（脏串 / 前导零）或越界返回 null */
export function uidKindOf(uid: string): AccountKind | null {
  if (!/^\d+$/.test(uid)) return null;
  const value = Number(uid);
  if (String(value) !== uid) return null;
  if (value >= ACCOUNT_UID_MIN && value <= ACCOUNT_UID_MAX) return 'account';
  if (value >= GUEST_UID_MIN && value <= GUEST_UID_MAX) return 'guest';
  return null;
}

/** 界面身份说明：「专属账号「Alice」· UID 123456789（9 位）」/「游客 · UID 1000000001（10 位）」 */
export function uidLabel(account: LocalAccount): string {
  const digits = account.uid.length;
  if (account.kind === 'account') {
    return `专属账号「${account.username ?? ''}」· UID ${account.uid}（${digits} 位）`;
  }
  return `游客 · UID ${account.uid}（${digits} 位）`;
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
    | { uid?: string; username?: string; error?: string }
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

/** 登录：取回该账号原来的 9 位 UID */
export async function loginAccount(username: string, password: string): Promise<LocalAccount> {
  return postAccount('/account/login', { username, password });
}