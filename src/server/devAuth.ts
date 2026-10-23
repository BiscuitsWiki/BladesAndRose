/**
 * 开发者授权（本地热座调试的解锁凭据）。
 *
 * 只放纯逻辑与内存状态，便于单测：
 *   - 邀请码校验：未配置即关闭，等时比较防时序侧信道；
 *   - dev token 的签发 / 校验 / 吊销：内存 Map、7 天过期、惰性清理。
 *     服务器重启即全量失效——低频操作重新登录即可，等于免费的全量吊销。
 * HTTP 层在 dev-server.ts 的 registerAccountApi。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** token 有效期：7 天 */
export const DEV_TOKEN_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * 邀请码校验：未配置（undefined / 空串）时一律拒绝，开发者注册不开放。
 * 双方都先哈希到定长再等时比较，既不因长度短路、也不泄露长度差异。
 */
export function devInviteValid(provided: string, configured: string | undefined): boolean {
  if (configured === undefined || configured === '') return false;
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(configured, 'utf8').digest();
  return timingSafeEqual(a, b);
}

interface DevTokenEntry {
  uid: string;
  expiresAt: number;
}

export class DevTokenStore {
  private readonly tokens = new Map<string, DevTokenEntry>();

  constructor(
    /** 当前时间（可注入便于单测） */
    private readonly now: () => number = Date.now,
    /** token 随机源（可注入便于单测） */
    private readonly randomToken: () => string = () => randomBytes(32).toString('base64url'),
  ) {}

  /** 签发 token：同一 UID 重复登录各持有独立 token，均可校验 */
  issue(uid: string): { token: string; expiresAt: number } {
    const expiresAt = this.now() + DEV_TOKEN_TTL_MS;
    const token = this.randomToken();
    this.tokens.set(token, { uid, expiresAt });
    this.prune();
    return { token, expiresAt };
  }

  /** 校验 token：不存在或已过期返回 null（过期条目顺手删除） */
  verify(token: string): { uid: string; expiresAt: number } | null {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.tokens.delete(token);
      return null;
    }
    return { ...entry };
  }

  /** 吊销单个 token（登出） */
  revoke(token: string): void {
    this.tokens.delete(token);
  }

  /** 吊销某 UID 的全部 token（删号时可用） */
  revokeUid(uid: string): void {
    for (const [token, entry] of [...this.tokens]) {
      if (entry.uid === uid) this.tokens.delete(token);
    }
  }

  /** 惰性清理过期条目，避免长期运行后 Map 无限增长 */
  private prune(): void {
    const now = this.now();
    for (const [token, entry] of [...this.tokens]) {
      if (entry.expiresAt <= now) this.tokens.delete(token);
    }
  }
}
