/**
 * 玩家账号与 UID。
 *
 * UID 由服务器发放、全局唯一，是玩家的身份标识（识别玩家看 UID，昵称只用于显示）：
 *   - 专属账号（用户名 + 密码注册）：9 位，100000000 – 999999999
 *   - 游客（临时账号，无需注册）：10 位，1000000000 – 9999999999
 * 两段区间按数值划分，判类型时不依赖字符串长度，也不怕带前导零的脏串。
 *
 * 账号表落盘到本地 JSON 文件（默认 data/accounts.json，可用环境变量 BLADES_ACCOUNTS_FILE 覆盖），
 * 服务器重启后账号不丢；房间与对局仍保持「进程内存、重启即清空」的既有做法。
 *
 * 文件分两区：上半是纯逻辑（UID 生成、用户名/密码校验与哈希、文件解析），不碰 fs、可直接单测；
 * 下半是文件读写（AccountStore）。注册 / 发号频率极低，落盘用同步写（天然串行，无需额外并发控制）。
 */
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- UID

/** 专属账号 UID 区间（9 位） */
export const ACCOUNT_UID_MIN = 100_000_000;
export const ACCOUNT_UID_MAX = 999_999_999;
/** 游客 UID 区间（10 位） */
export const GUEST_UID_MIN = 1_000_000_000;
export const GUEST_UID_MAX = 9_999_999_999;

export type UidKind = 'account' | 'guest';

/**
 * 判 UID 类型：必须是规范的十进制整数（无前导零、无多余字符）且落在对应区间。
 * 非法（空串、脏串、越界、11 位及以上）返回 null。
 */
export function uidKind(uid: string): UidKind | null {
  if (!/^\d+$/.test(uid)) return null;
  const value = Number(uid);
  if (String(value) !== uid) return null; // 拒绝 "012345678" 这类带前导零的写法
  if (value >= ACCOUNT_UID_MIN && value <= ACCOUNT_UID_MAX) return 'account';
  if (value >= GUEST_UID_MIN && value <= GUEST_UID_MAX) return 'guest';
  return null;
}

/**
 * 取一个未被占用的 UID（kind 决定区间）；isTaken 用于避开已发出的号。
 * 随机源可注入，便于测试；连续 100 次都撞号说明号段真的满了（开发规模不会发生）。
 */
export function randomUid(
  kind: UidKind,
  isTaken: (uid: string) => boolean,
  next: (min: number, max: number) => number = (min, max) => randomInt(min, max + 1),
): string {
  const min = kind === 'account' ? ACCOUNT_UID_MIN : GUEST_UID_MIN;
  const max = kind === 'account' ? ACCOUNT_UID_MAX : GUEST_UID_MAX;
  for (let attempt = 0; attempt < 100; attempt++) {
    const uid = String(next(min, max));
    if (!isTaken(uid)) return uid;
  }
  throw new Error('UID 分配失败：连续 100 次都撞上已发出的号');
}

// ---------------------------------------------------------------- 用户名与密码

/** 用户名：2–16 位中文 / 字母 / 数字 / 下划线 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_\u4e00-\u9fa5]{2,16}$/;

export function validUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

/** 唯一性比对用的规范化形式：去首尾空白 + 统一小写（Alice 与 alice 视为同一个名字） */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** 密码：6–64 个字符，且不含首尾空白（避免「看起来一样其实不同」） */
export function validPassword(password: string): boolean {
  return password.length >= 6 && password.length <= 64 && password.trim() === password;
}

const KEY_LENGTH = 64;

/** 加盐哈希（scrypt）；同步版本足够（注册 / 登录频率极低），且省掉写表的时序问题 */
export function hashPassword(
  password: string,
  salt: string = randomBytes(16).toString('hex'),
): { salt: string; hash: string } {
  return { salt, hash: scryptSync(password, salt, KEY_LENGTH).toString('hex') };
}

export function verifyPassword(password: string, record: { salt: string; hash: string }): boolean {
  const expected = Buffer.from(record.hash, 'hex');
  if (expected.length === 0) return false;
  const actual = scryptSync(password, record.salt, expected.length);
  return timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------- 账号表结构

export interface AccountRecord {
  /** 9 位专属 UID */
  uid: string;
  username: string;
  /** 唯一性比对用的规范化用户名（小写） */
  nameKey: string;
  salt: string;
  hash: string;
  createdAt: number;
}

export interface AccountFile {
  version: 1;
  accounts: AccountRecord[];
  /** 已发出的游客 UID：避免服务器重启后重复发号 */
  guests: string[];
}

export function emptyAccountFile(): AccountFile {
  return { version: 1, accounts: [], guests: [] };
}

function isAccountRecord(value: unknown): value is AccountRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<AccountRecord>;
  return (
    typeof record.uid === 'string' &&
    uidKind(record.uid) === 'account' &&
    typeof record.username === 'string' &&
    typeof record.nameKey === 'string' &&
    typeof record.salt === 'string' &&
    typeof record.hash === 'string' &&
    typeof record.createdAt === 'number'
  );
}

/** 宽容解析：文件缺失 / 空 / 坏 JSON / 结构不符一律降级为空表并给出提示，绝不抛错中断启动 */
export function parseAccountFile(text: string | null): { file: AccountFile; warning: string | null } {
  if (text === null || text.trim() === '') return { file: emptyAccountFile(), warning: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { file: emptyAccountFile(), warning: '账号文件不是合法 JSON，已按空表启动' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { file: emptyAccountFile(), warning: '账号文件结构不符，已按空表启动' };
  }
  const data = raw as { version?: unknown; accounts?: unknown; guests?: unknown };
  if (data.version !== 1 || !Array.isArray(data.accounts) || !Array.isArray(data.guests)) {
    return { file: emptyAccountFile(), warning: '账号文件结构不符，已按空表启动' };
  }
  const accounts = data.accounts.filter(isAccountRecord);
  const guests = data.guests.filter((uid): uid is string => typeof uid === 'string' && uidKind(uid) === 'guest');
  const dropped = accounts.length !== data.accounts.length || guests.length !== data.guests.length;
  return { file: { version: 1, accounts, guests }, warning: dropped ? '账号文件里有非法条目，已跳过' : null };
}

export function serializeAccountFile(file: AccountFile): string {
  return JSON.stringify(file, null, 2);
}

/** 账号文件路径：默认项目根目录下的 data/accounts.json */
export function defaultAccountFilePath(): string {
  return process.env.BLADES_ACCOUNTS_FILE ?? path.resolve(process.cwd(), 'data', 'accounts.json');
}

// ---------------------------------------------------------------- 账号表读写

export type StoreResult = { ok: true; record: AccountRecord } | { ok: false; status: 400 | 401 | 409 | 500; error: string };

export class AccountStore {
  private file: AccountFile = emptyAccountFile();

  constructor(private readonly filePath: string = defaultAccountFilePath()) {}

  /** 启动加载；文件缺失按空表，损坏则备份为 .corrupt 后按空表启动（服务不中断） */
  load(): { warning: string | null } {
    let text: string | null = null;
    try {
      text = existsSync(this.filePath) ? readFileSync(this.filePath, 'utf8') : null;
    } catch (error) {
      console.warn('[accounts] 读取账号文件失败：', error);
    }
    const { file, warning } = parseAccountFile(text);
    this.file = file;
    if (warning !== null) {
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt`);
      } catch {
        // 备份失败不影响启动
      }
      console.warn(`[accounts] ${warning}（原文件已备份为 ${this.filePath}.corrupt）`);
    }
    return { warning };
  }

  get path(): string {
    return this.filePath;
  }

  get accountCount(): number {
    return this.file.accounts.length;
  }

  /** 给新访客发一个 10 位 UID；发号即落盘，避免重启后重复发放 */
  allocateGuestUid(): string {
    const uid = randomUid('guest', (candidate) => this.isTaken(candidate));
    this.file.guests.push(uid);
    if (!this.persist()) {
      // 落盘失败不阻断访客使用：本次进程内 UID 依旧唯一，仅重启后有小概率重发
      this.file.guests.pop();
    }
    return uid;
  }

  register(username: string, password: string): StoreResult {
    const name = username.trim();
    if (!validUsername(name)) {
      return { ok: false, status: 400, error: '用户名需 2–16 位中文 / 字母 / 数字 / 下划线' };
    }
    if (!validPassword(password)) {
      return { ok: false, status: 400, error: '密码需 6–64 个字符（不含首尾空白）' };
    }
    if (this.findByName(name)) {
      return { ok: false, status: 409, error: '用户名已被注册' };
    }

    const record: AccountRecord = {
      uid: randomUid('account', (candidate) => this.isTaken(candidate)),
      username: name,
      nameKey: normalizeUsername(name),
      ...hashPassword(password),
      createdAt: Date.now(),
    };
    this.file.accounts.push(record);
    if (!this.persist()) {
      // 落盘失败即回滚：避免「注册看似成功、重启后消失」
      this.file.accounts.pop();
      return { ok: false, status: 500, error: '账号写入失败，请重试' };
    }
    return { ok: true, record };
  }

  login(username: string, password: string): StoreResult {
    const name = username.trim();
    if (name === '' || password === '') {
      return { ok: false, status: 400, error: '请输入用户名与密码' };
    }
    const record = this.findByName(name);
    // 用户不存在与密码错误统一文案，避免枚举账号
    if (!record || !verifyPassword(password, record)) {
      return { ok: false, status: 401, error: '用户名或密码错误' };
    }
    return { ok: true, record };
  }

  private findByName(username: string): AccountRecord | undefined {
    const key = normalizeUsername(username);
    return this.file.accounts.find((account) => account.nameKey === key);
  }

  private isTaken(uid: string): boolean {
    return this.file.accounts.some((account) => account.uid === uid) || this.file.guests.includes(uid);
  }

  /** 原子写：先写临时文件再改名覆盖（频率极低，同步写即天然串行） */
  private persist(): boolean {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, serializeAccountFile(this.file), 'utf8');
      renameSync(tmp, this.filePath);
      return true;
    } catch (error) {
      console.warn('[accounts] 写入账号文件失败：', error);
      return false;
    }
  }
}