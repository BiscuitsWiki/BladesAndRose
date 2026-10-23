import { describe, expect, it } from 'vitest';
import { DEV_TOKEN_TTL_MS, DevTokenStore, devInviteValid } from '../devAuth';

describe('邀请码校验（devInviteValid）', () => {
  it('未配置（undefined / 空）一律拒绝，开发者注册不开放', () => {
    expect(devInviteValid('anything', undefined)).toBe(false);
    expect(devInviteValid('anything', '')).toBe(false);
    expect(devInviteValid('', undefined)).toBe(false);
  });

  it('仅完全一致才通过（含前后空白与空串差异）', () => {
    expect(devInviteValid('invite-1', 'invite-1')).toBe(true);
    expect(devInviteValid('invite-2', 'invite-1')).toBe(false);
    expect(devInviteValid('invite-1 ', 'invite-1')).toBe(false);
    expect(devInviteValid('', 'invite-1')).toBe(false);
  });
});

describe('DevTokenStore（签发 / 校验 / 吊销）', () => {
  it('签发的 token 可校验，携带 uid 与过期时刻（7 天）', () => {
    let now = 1000;
    let seq = 0;
    const store = new DevTokenStore(() => now, () => `tk-${++seq}`);
    const { token, expiresAt } = store.issue('12345678');
    expect(token).toBe('tk-1');
    expect(expiresAt).toBe(1000 + DEV_TOKEN_TTL_MS);
    expect(store.verify(token)).toEqual({ uid: '12345678', expiresAt });
  });

  it('过期 token 校验返回 null（到期时刻即视为过期）', () => {
    let now = 1000;
    const store = new DevTokenStore(() => now, () => 'tk');
    const { token } = store.issue('12345678');
    now += DEV_TOKEN_TTL_MS;
    expect(store.verify(token)).toBeNull();
    expect(store.verify('never-issued')).toBeNull();
  });

  it('revoke 吊销单个 token，revokeUid 吊销该 UID 全部 token', () => {
    let seq = 0;
    const store = new DevTokenStore(Date.now, () => `tk-${++seq}`);
    const a = store.issue('12345678').token;
    const b = store.issue('12345678').token;
    const c = store.issue('87654321').token;
    store.revoke(a);
    expect(store.verify(a)).toBeNull();
    expect(store.verify(b)).not.toBeNull();
    store.revokeUid('12345678');
    expect(store.verify(b)).toBeNull();
    expect(store.verify(c)).not.toBeNull();
  });

  it('并发签发的 token 互不覆盖（真实随机源，无重复）', () => {
    const store = new DevTokenStore();
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i++) tokens.add(store.issue('12345678').token);
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(store.verify(token)).not.toBeNull();
  });
});
