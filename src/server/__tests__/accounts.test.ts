import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_UID_MAX,
  ACCOUNT_UID_MIN,
  AccountStore,
  DEV_UID_MAX,
  DEV_UID_MIN,
  GUEST_UID_MAX,
  GUEST_UID_MIN,
  hashPassword,
  MAX_GUEST_RECORDS,
  parseAccountFile,
  randomUid,
  serializeAccountFile,
  trimGuests,
  uidKind,
  validPassword,
  validUsername,
  verifyPassword,
} from '../accounts';

const dirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bar-accounts-'));
  dirs.push(dir);
  return path.join(dir, 'data', 'accounts.json');
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('UID 区间与生成', () => {
  it('按数值划分三段区间：8 位开发者、9 位专属账号、10 位游客', () => {
    expect(uidKind(String(DEV_UID_MIN))).toBe('dev');
    expect(uidKind(String(DEV_UID_MAX))).toBe('dev');
    expect(uidKind(String(ACCOUNT_UID_MIN))).toBe('account');
    expect(uidKind(String(ACCOUNT_UID_MAX))).toBe('account');
    expect(uidKind(String(GUEST_UID_MIN))).toBe('guest');
    expect(uidKind(String(GUEST_UID_MAX))).toBe('guest');
  });

  it('非法 UID（位数不足 / 越界 / 脏串 / 带前导零 / 11 位）一律拒绝', () => {
    for (const uid of ['', '9999999', '0', '10000000000', '012345678', '100000000a', ' 100000000', '1e8', '123.456789']) {
      expect(uidKind(uid)).toBeNull();
    }
  });

  it('随机发号落在对应区间内', () => {
    for (let i = 0; i < 50; i++) {
      const dev = randomUid('dev', () => false);
      expect(uidKind(dev)).toBe('dev');
      const account = randomUid('account', () => false);
      expect(uidKind(account)).toBe('account');
      const guest = randomUid('guest', () => false);
      expect(uidKind(guest)).toBe('guest');
    }
  });

  it('撞上已发出的号时重试', () => {
    const sequence = [ACCOUNT_UID_MIN, ACCOUNT_UID_MIN, ACCOUNT_UID_MIN + 7];
    const taken = new Set([String(ACCOUNT_UID_MIN)]);
    const uid = randomUid('account', (candidate) => taken.has(candidate), () => sequence.shift()!);
    expect(uid).toBe(String(ACCOUNT_UID_MIN + 7));
  });
});

describe('用户名与密码校验', () => {
  it('用户名：2–16 位中文 / 字母 / 数字 / 下划线', () => {
    expect(validUsername('Alice')).toBe(true);
    expect(validUsername('白蔷薇_01')).toBe(true);
    expect(validUsername('a')).toBe(false);
    expect(validUsername('a'.repeat(17))).toBe(false);
    expect(validUsername('a b')).toBe(false);
    expect(validUsername('a@b')).toBe(false);
  });

  it('密码：6–64 个字符且不含首尾空白', () => {
    expect(validPassword('secret123')).toBe(true);
    expect(validPassword('12345')).toBe(false);
    expect(validPassword('123456')).toBe(true);
    expect(validPassword(' secret')).toBe(false);
    expect(validPassword('a'.repeat(65))).toBe(false);
  });

  it('加盐哈希：同一密码两次的盐与哈希都不同，校验能通过', () => {
    const first = hashPassword('secret123');
    const second = hashPassword('secret123');
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    expect(verifyPassword('secret123', first)).toBe(true);
    expect(verifyPassword('secret124', first)).toBe(false);
    expect(verifyPassword('secret123', { salt: first.salt, hash: '' })).toBe(false);
  });
});

describe('账号文件解析', () => {
  it('空 / 坏 JSON / 结构不符都降级为空表并给出提示', () => {
    expect(parseAccountFile(null).file.accounts).toEqual([]);
    expect(parseAccountFile('   ').warning).toBeNull();
    expect(parseAccountFile('{oops').file.accounts).toEqual([]);
    expect(parseAccountFile('{oops').warning).toContain('合法 JSON');
    expect(parseAccountFile('{"version":2,"accounts":[],"guests":[]}').warning).toContain('结构不符');
    expect(parseAccountFile('[]').warning).toContain('结构不符');
  });

  it('跳过非法条目并保留合法部分', () => {
    const text = JSON.stringify({
      version: 1,
      accounts: [
        { uid: '123456789', username: 'Alice', nameKey: 'alice', salt: 'ab', hash: 'cd', createdAt: 1 },
        { uid: '1234', username: 'Bad', nameKey: 'bad', salt: 'ab', hash: 'cd', createdAt: 1 },
      ],
      guests: ['1000000001', 'nope'],
    });
    const { file, warning } = parseAccountFile(text);
    expect(file.accounts).toHaveLength(1);
    expect(file.guests).toEqual(['1000000001']);
    expect(warning).toContain('非法条目');
  });

  it('序列化可往返', () => {
    const file = { version: 1 as const, accounts: [], guests: ['1000000001'] };
    expect(parseAccountFile(serializeAccountFile(file)).file).toEqual(file);
  });

  it('游客发号记录只保留最近的 MAX_GUEST_RECORDS 条（防文件无限增长）', () => {
    const many = Array.from({ length: MAX_GUEST_RECORDS + 5 }, (_, i) => String(GUEST_UID_MIN + i));
    const trimmed = trimGuests(many);
    expect(trimmed).toHaveLength(MAX_GUEST_RECORDS);
    expect(trimmed[0]).toBe(String(GUEST_UID_MIN + 5)); // 最旧的 5 条被淘汰
    expect(trimGuests(['1000000001'])).toEqual(['1000000001']); // 未超限时原样保留

    // 解析路径同样裁剪；裁剪属正常操作，不算「非法条目」告警
    const text = JSON.stringify({ version: 1, accounts: [], guests: many });
    const { file, warning } = parseAccountFile(text);
    expect(file.guests).toHaveLength(MAX_GUEST_RECORDS);
    expect(warning).toBeNull();
  });
});

describe('AccountStore（含落盘）', () => {
  it('注册 → 重新加载 → 用同一密码登录拿到同一个 9 位 UID', () => {
    const file = tempFile();
    const store = new AccountStore(file);
    store.load();
    const registered = store.register('Alice', 'secret123');
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(uidKind(registered.record.uid)).toBe('account');
    expect(registered.record.uid).toHaveLength(9);

    // 模拟服务器重启：换一个 store 实例重新加载同一个文件
    const reloaded = new AccountStore(file);
    reloaded.load();
    const login = reloaded.login('alice', 'secret123'); // 用户名大小写不敏感
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    expect(login.record.uid).toBe(registered.record.uid);
    expect(reloaded.login('Alice', 'wrong-password')).toMatchObject({ ok: false, status: 401 });
  });

  it('用户名唯一（大小写不敏感），重复注册返回 409', () => {
    const store = new AccountStore(tempFile());
    store.load();
    expect(store.register('Alice', 'secret123').ok).toBe(true);
    expect(store.register('alice', 'secret456')).toMatchObject({ ok: false, status: 409 });
    expect(store.register('a', 'secret456')).toMatchObject({ ok: false, status: 400 });
  });

  it('开发者账号：kind="dev" 发 8 位 UID，findByUid 可查（删号即吊销）', () => {
    const store = new AccountStore(tempFile());
    store.load();
    const registered = store.register('DevUser', 'secret123', 'dev');
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(uidKind(registered.record.uid)).toBe('dev');
    expect(registered.record.uid).toHaveLength(8);
    expect(store.findByUid(registered.record.uid)).toEqual(registered.record);
    expect(store.findByUid('10000000')).toBeUndefined();
    // 同池查重：dev 账号与正式账号用户名互斥
    expect(store.register('devuser', 'secret456')).toMatchObject({ ok: false, status: 409 });
  });

  it('解析接受 dev 记录，旧账号文件零迁移', () => {
    const text = JSON.stringify({
      version: 1,
      accounts: [
        { uid: '12345678', username: 'Dev', nameKey: 'dev', salt: 'ab', hash: 'cd', createdAt: 1 },
        { uid: '123456789', username: 'Alice', nameKey: 'alice', salt: 'ab', hash: 'cd', createdAt: 1 },
      ],
      guests: ['1000000001'],
    });
    const { file, warning } = parseAccountFile(text);
    expect(file.accounts).toHaveLength(2);
    expect(file.guests).toEqual(['1000000001']);
    expect(warning).toBeNull();
  });

  it('游客发号落在 10 位区间，且重启后不重复发放', () => {
    const file = tempFile();
    const store = new AccountStore(file);
    store.load();
    const issued = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const uid = store.allocateGuestUid();
      expect(uidKind(uid)).toBe('guest');
      expect(issued.has(uid)).toBe(false);
      issued.add(uid);
    }
    const reloaded = new AccountStore(file);
    reloaded.load();
    for (let i = 0; i < 20; i++) {
      const uid = reloaded.allocateGuestUid();
      expect(issued.has(uid)).toBe(false);
      issued.add(uid);
    }
  });

  it('落盘文件里没有明文密码（只有盐与派生值）', () => {
    const file = tempFile();
    const store = new AccountStore(file);
    store.load();
    store.register('Alice', 'secret123');
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('secret123');
    expect(JSON.parse(text).accounts[0].hash.length).toBeGreaterThan(0);
  });

  it('文件损坏时备份为 .corrupt 并按空表启动', () => {
    const file = tempFile();
    const store = new AccountStore(file);
    store.load();
    store.register('Alice', 'secret123');
    // 写入坏内容后重新加载
    const broken = new AccountStore(file);
    writeFileSync(file, '{broken', 'utf8');
    const result = broken.load();
    expect(result.warning).toContain('合法 JSON');
    expect(broken.accountCount).toBe(0);
    expect(readFileSync(`${file}.corrupt`, 'utf8')).toBe('{broken');
  });
});