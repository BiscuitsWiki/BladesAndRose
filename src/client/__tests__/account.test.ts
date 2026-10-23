import { describe, expect, it } from 'vitest';
import { parseDevToken, uidKindOf, uidLabel } from '../account';

describe('UID 类型判定（客户端，与服务端同规则）', () => {
  it('8 位是开发者账号，9 位是专属账号，10 位是游客', () => {
    expect(uidKindOf('10000000')).toBe('dev');
    expect(uidKindOf('99999999')).toBe('dev');
    expect(uidKindOf('100000000')).toBe('account');
    expect(uidKindOf('999999999')).toBe('account');
    expect(uidKindOf('1000000000')).toBe('guest');
    expect(uidKindOf('9999999999')).toBe('guest');
  });

  it('位数不足 / 越界 / 脏串 / 前导零一律判为非法', () => {
    for (const uid of ['', '9999999', '10000000000', '012345678', '12345abcde', ' 100000000']) {
      expect(uidKindOf(uid)).toBeNull();
    }
  });
});

describe('身份文案（uidLabel）', () => {
  it('开发者账号显示用户名与 UID', () => {
    expect(uidLabel({ uid: '12345678', kind: 'dev', username: 'Bob' })).toBe(
      '开发者账号「Bob」· UID 12345678',
    );
  });

  it('专属账号显示用户名与 UID（不显示位数）', () => {
    expect(uidLabel({ uid: '123456789', kind: 'account', username: 'Alice' })).toBe(
      '专属账号「Alice」· UID 123456789',
    );
  });

  it('游客显示身份与 UID（不显示位数）', () => {
    expect(uidLabel({ uid: '1000000001', kind: 'guest' })).toBe('游客 · UID 1000000001');
  });
});

describe('开发者授权解析（parseDevToken）', () => {
  const token = { token: 'tk', uid: '12345678', expiresAt: 2000 };

  it('合法且未过期的授权原样返回', () => {
    expect(parseDevToken(JSON.stringify(token), 1000)).toEqual(token);
  });

  it('缺失 / 损坏 / 结构不符 / 已过期一律返回 null', () => {
    expect(parseDevToken(null, 1000)).toBeNull();
    expect(parseDevToken('{oops', 1000)).toBeNull();
    expect(parseDevToken(JSON.stringify({ token: 'tk' }), 1000)).toBeNull();
    expect(parseDevToken(JSON.stringify(token), 2000)).toBeNull(); // 到期时刻视为已过期
    expect(parseDevToken(JSON.stringify(token), 3000)).toBeNull();
  });
});
