import { describe, expect, it } from 'vitest';
import { uidKindOf, uidLabel } from '../account';

describe('UID 类型判定（客户端，与服务端同规则）', () => {
  it('9 位是专属账号，10 位是游客', () => {
    expect(uidKindOf('100000000')).toBe('account');
    expect(uidKindOf('999999999')).toBe('account');
    expect(uidKindOf('1000000000')).toBe('guest');
    expect(uidKindOf('9999999999')).toBe('guest');
  });

  it('位数不足 / 越界 / 脏串 / 前导零一律判为非法', () => {
    for (const uid of ['', '99999999', '12345678', '10000000000', '012345678', '12345abcde', ' 100000000']) {
      expect(uidKindOf(uid)).toBeNull();
    }
  });
});

describe('身份文案（uidLabel）', () => {
  it('专属账号显示用户名与 UID（不显示位数）', () => {
    expect(uidLabel({ uid: '123456789', kind: 'account', username: 'Alice' })).toBe(
      '专属账号「Alice」· UID 123456789',
    );
  });

  it('游客显示身份与 UID（不显示位数）', () => {
    expect(uidLabel({ uid: '1000000001', kind: 'guest' })).toBe('游客 · UID 1000000001');
  });
});