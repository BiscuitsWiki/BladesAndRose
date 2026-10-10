import { describe, expect, it } from 'vitest';
import { decideSeatClaim, isSeatKey, pickLatestGame, seatMetaOf, type SeatClaimInput } from '../seats';

const UID = '123456789';
const OTHER_UID = '987654321';

function input(over: Partial<SeatClaimInput> = {}): SeatClaimInput {
  return {
    players: { 0: {}, 1: {}, 2: {} },
    uids: new Map<string, string>(),
    seat: '1',
    uid: UID,
    credentials: null,
    ...over,
  };
}

describe('座位认领决策（decideSeatClaim）', () => {
  it('已占用 + 绑定就是本 UID：归还现有凭据（不轮换）', () => {
    const decision = decideSeatClaim(
      input({ players: { 1: { name: 'Alice', credentials: 'cred-a' } }, uids: new Map([['1', UID]]) }),
    );
    expect(decision).toEqual({ kind: 'reclaim', credentials: 'cred-a' });
  });

  it('已占用 + 未绑定 + 凭据匹配：补绑本 UID', () => {
    const decision = decideSeatClaim(
      input({ players: { 1: { name: 'Alice', credentials: 'cred-a' } }, credentials: 'cred-a' }),
    );
    expect(decision).toEqual({ kind: 'rebind', credentials: 'cred-a' });
  });

  it('已占用 + 未绑定 + 凭据不匹配或缺失：409 seat-unbound', () => {
    const occupied = { players: { 1: { name: 'Alice', credentials: 'cred-a' } } };
    expect(decideSeatClaim(input({ ...occupied, credentials: 'wrong' }))).toMatchObject({
      kind: 'error',
      status: 409,
      code: 'seat-unbound',
    });
    expect(decideSeatClaim(input(occupied))).toMatchObject({ kind: 'error', status: 409 });
  });

  it('已占用 + 绑定是别人的 UID：403 seat-taken', () => {
    const decision = decideSeatClaim(
      input({
        players: { 1: { name: 'Bob', credentials: 'cred-b' } },
        uids: new Map([['1', OTHER_UID]]),
        credentials: 'cred-b', // 即使碰巧拿到凭据，也不能换绑到本 UID
      }),
    );
    expect(decision).toMatchObject({ kind: 'error', status: 403, code: 'seat-taken' });
  });

  it('空座位一律允许占座（含曾绑定过其他 UID 的）', () => {
    expect(decideSeatClaim(input())).toEqual({ kind: 'occupy' });
    expect(decideSeatClaim(input({ uids: new Map([['1', OTHER_UID]]) }))).toEqual({ kind: 'occupy' });
  });

  it('座位号不存在：404 seat-not-found', () => {
    expect(decideSeatClaim(input({ seat: '9' }))).toMatchObject({
      kind: 'error',
      status: 404,
      code: 'no-seat',
    });
  });
});

describe('座位键校验（原型污染防护）', () => {
  /** 模拟「原型链被污染」的对象：自有键只有真实座位，原型上却挂着 name / credentials */
  function poisonedPlayers(): Record<string, { name?: string; credentials?: string }> {
    const players = Object.create({
      name: 'PWN',
      credentials: 'injected-credential',
      evil: { name: 'PWN', credentials: 'injected-credential' },
    }) as Record<string, { name?: string; credentials?: string }>;
    players['0'] = { name: 'Alice', credentials: 'cred-0' };
    players['1'] = {};
    return players;
  }

  it('只认「自有 + 纯数字」的座位键', () => {
    const players = poisonedPlayers();
    expect(isSeatKey(players, '0')).toBe(true);
    expect(isSeatKey(players, '1')).toBe(true);
    for (const key of ['__proto__', 'constructor', 'prototype', 'toString', 'evil', '0x1', ' 0', '', '9', '-1']) {
      expect(isSeatKey(players, key), key).toBe(false);
    }
  });

  it('原型链键取不到座位条目（不会读到原型上的值）', () => {
    const players = poisonedPlayers();
    expect(seatMetaOf(players, 'evil')).toBeUndefined();
    expect(seatMetaOf(players, '__proto__')).toBeUndefined();
    expect(seatMetaOf(players, 'constructor')).toBeUndefined();
    expect(seatMetaOf(players, '0')?.name).toBe('Alice');
  });

  it('认领原型链键一律按「座位不存在」拒绝，绝不写入原型', () => {
    const players = poisonedPlayers();
    for (const key of ['__proto__', 'constructor', 'evil', 'toString']) {
      const decision = decideSeatClaim(input({ players, seat: key, credentials: 'injected-credential' }));
      expect(decision, key).toMatchObject({ kind: 'error', status: 404, code: 'no-seat' });
    }
    // 原型上的属性没有被改写
    const proto = Object.getPrototypeOf(players) as { name?: string; credentials?: string };
    expect(proto.name).toBe('PWN');
    expect(proto.credentials).toBe('injected-credential');
  });

  it('原型链键不会被当成「已占用」座位或通过凭据补绑', () => {
    const players = poisonedPlayers();
    // 即使带上与原型上相同的凭据，也不能补绑到原型链键
    expect(decideSeatClaim(input({ players, seat: 'evil', credentials: 'injected-credential' }))).toMatchObject({
      kind: 'error',
      status: 404,
    });
    // 真实的自有座位仍然正常：凭据匹配可补绑
    expect(decideSeatClaim(input({ players, seat: '0', credentials: 'cred-0' }))).toEqual({
      kind: 'rebind',
      credentials: 'cred-0',
    });
  });
});

describe('选最近活跃的一局（pickLatestGame）', () => {
  it('空列表返回 null', () => {
    expect(pickLatestGame([])).toBeNull();
  });

  it('取 updatedAt 最大的一局；同值时按房间号定序', () => {
    const games = [
      { room: 'AAA', updatedAt: 10 },
      { room: 'BBB', updatedAt: 30 },
      { room: 'CCC', updatedAt: 20 },
    ];
    expect(pickLatestGame(games)?.room).toBe('BBB');
    expect(pickLatestGame([{ room: 'AAA', updatedAt: 5 }, { room: 'ZZZ', updatedAt: 5 }])?.room).toBe('ZZZ');
  });
});