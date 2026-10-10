import { describe, expect, it } from 'vitest';
import {
  applyMove,
  countBuds,
  createGame,
  CRYSTAL_TO_SKILL,
  distributionSignature,
  officialDistribution,
  parseDistribution,
  playerView,
  skillOfCrystal,
  type Card,
  type GameState,
  type Role,
  type SetupOptions,
} from '../index';

const NAMES = ['A', 'B', 'C', 'D', 'E'];

/** 5 人局固定角色，方便精确控制 */
const ROLES_5: Record<number, Role> = {
  0: 'whiteRose',
  1: 'bishop',
  2: 'believer',
  3: 'doubleBlade',
  4: 'darkBlade',
};

function newGame(over: Partial<SetupOptions> = {}): GameState {
  return createGame(NAMES, {
    seed: 42,
    roles: ROLES_5,
    coinSeat: 0,
    crystals: { 0: 2 }, // 水晶 2 = 顺序公开，不产生任何出牌约束
    ...over,
  });
}

const p = (s: GameState, seat: number) => s.players[seat]!;

function roleCardId(s: GameState, seat: number, role: Role): string {
  const c = p(s, seat).hand.find((x) => x.kind === 'role' && x.role === role);
  if (!c) throw new Error(`座位 ${seat} 手中没有 ${role}`);
  return c.id;
}

function plainCardId(s: GameState, seat: number, kind: 'ghost' | 'believer'): string {
  const c = p(s, seat).hand.find((x) => x.kind === kind);
  if (!c) throw new Error(`座位 ${seat} 手中没有 ${kind}`);
  return c.id;
}

const play = (s: GameState, seat: number, cardId: string) =>
  applyMove(s, { type: 'playCard', playerId: p(s, seat).id, cardId });

const pass = (s: GameState, seat: number) =>
  applyMove(s, { type: 'passTurn', playerId: p(s, seat).id });

/** 上一轮公开里的出牌情况名单（自持币者起、只含 id 与是否出牌） */
const playStatus = (s: GameState) => s.lastReveal?.playStatus;

/** 公开日志里的「出牌情况」行（与面板同源数据） */
const statusLine = (s: GameState) => s.log.find((l) => l.includes('出牌情况'));

/** 让 p0 把硬币交给自己并翻开水晶，进入出牌阶段 */
function openRound(s: GameState) {
  return applyMove(s, { type: 'passCoin', playerId: 'p0', to: 'p0' });
}

describe('准备与夜晚阶段', () => {
  it('按人数发角色牌并锁定阵营', () => {
    const s = newGame();
    expect(s.players.map((x) => x.role)).toEqual([
      'whiteRose',
      'bishop',
      'believer',
      'doubleBlade',
      'darkBlade',
    ]);
    expect(s.players.map((x) => x.faction)).toEqual([
      'whiteRose',
      'whiteRose',
      'whiteRose',
      'bloodBlade',
      'bloodBlade',
    ]);
    expect(s.players.every((x) => x.hand.length === 3)).toBe(true);
    expect(s.phase).toBe('magic');
    expect(s.round).toBe(1);
  });

  it('双刃强制用幽魂换走版图旁的双刃，无玩家决策', () => {
    const s = newGame();
    const db = p(s, 3);
    expect(db.hand.filter((c) => c.kind === 'role' && c.role === 'doubleBlade')).toHaveLength(2);
    expect(db.hand.filter((c) => c.kind === 'believer')).toHaveLength(1);
    expect(db.hand.some((c) => c.kind === 'ghost')).toBe(false);
    // 换出的幽魂留在版图旁，成为 7 号效果的取牌来源
    expect(s.zones.ghosts).toHaveLength(1);
  });

  it('夜晚阶段的公开日志不泄露双刃身份', () => {
    const s = newGame();
    // 双刃换牌是夜间秘密动作：日志一旦出现角色名，等于向所有人公开「谁是双刃」
    expect(s.log.join('\n')).not.toContain('双刃');
  });

  it('互认名单只发给白蔷薇/司教/双刃/巨刃，且只包含同组的人', () => {
    const s = newGame();
    const knowledgeOf = (seat: number) => s.knowledge[p(s, seat).id]!;
    const groupOf = (seat: number) => {
      const k = knowledgeOf(seat).find((x) => x.kind === 'nightGroup');
      return k && k.kind === 'nightGroup' ? k.players : null;
    };
    expect(groupOf(0)).toEqual([p(s, 0).id, p(s, 1).id, p(s, 3).id]); // 白蔷薇 + 司教 + 双刃
    expect(groupOf(1)).toEqual(groupOf(0));
    expect(groupOf(3)).toEqual(groupOf(0));
    expect(knowledgeOf(2)).toHaveLength(0); // 信者不睁眼
    expect(knowledgeOf(4)).toHaveLength(0); // 暗刃不睁眼
  });

  it('7 人局会出现巨刃，10 人局分布与规则书一致', () => {
    const seven = createGame(['A', 'B', 'C', 'D', 'E', 'F', 'G'], { seed: 7 });
    expect(seven.players.filter((x) => x.role === 'greatBlade')).toHaveLength(1);
    const ten = createGame(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
      { seed: 7 },
    );
    const count = (role: Role) => ten.players.filter((x) => x.role === role).length;
    expect(count('whiteRose')).toBe(1);
    expect(count('bishop')).toBe(1);
    expect(count('believer')).toBe(4);
    expect(count('greatBlade')).toBe(2);
    expect(count('doubleBlade')).toBe(1);
    expect(count('darkBlade')).toBe(1);
  });

  it('支持自定义角色配比（白蔷薇、暗刃固定 1 名）', () => {
    const s = createGame(NAMES, {
      seed: 1,
      distribution: {
        whiteRose: 1,
        bishop: 0,
        believer: 2,
        doubleBlade: 0,
        greatBlade: 1,
        darkBlade: 1,
      },
    });
    const count = (role: Role) => s.players.filter((x) => x.role === role).length;
    expect(count('whiteRose')).toBe(1);
    expect(count('bishop')).toBe(0);
    expect(count('believer')).toBe(2);
    expect(count('greatBlade')).toBe(1);
    expect(count('doubleBlade')).toBe(0);
    expect(count('darkBlade')).toBe(1);
    // 只指定部分角色时，其余沿用官方值（官方 5 人局 believer=1 / greatBlade=0）
    const partial = createGame(NAMES, {
      seed: 1,
      distribution: { believer: 0, greatBlade: 1 },
    });
    expect(partial.players.filter((x) => x.role === 'greatBlade')).toHaveLength(1);
    expect(partial.players.filter((x) => x.role === 'believer')).toHaveLength(0);
    expect(partial.players).toHaveLength(5);
  });

  it('配比合计与人数不一致时拒绝开局', () => {
    expect(() =>
      createGame(NAMES, {
        distribution: {
          whiteRose: 1,
          bishop: 0,
          believer: 1,
          doubleBlade: 0,
          greatBlade: 0,
          darkBlade: 1,
        },
      }),
    ).toThrow(/不一致/);
  });

  it('白蔷薇与暗刃必须有且只能有 1 名', () => {
    expect(() =>
      createGame(NAMES, { distribution: { whiteRose: 0, believer: 2 } }),
    ).toThrow(/白蔷薇/);
    expect(() =>
      createGame(NAMES, { distribution: { whiteRose: 2, believer: 0 } }),
    ).toThrow(/白蔷薇/);
    expect(() =>
      createGame(NAMES, { distribution: { darkBlade: 0, believer: 2 } }),
    ).toThrow(/暗刃/);
    expect(() =>
      createGame(NAMES, { distribution: { darkBlade: 2, believer: 0 } }),
    ).toThrow(/暗刃/);
  });

  it('配比签名可以往返解析', () => {
    const dist = officialDistribution(7);
    expect(parseDistribution(distributionSignature(dist))).toEqual(dist);
    expect(parseDistribution('1,1,2')).toBeNull();
    expect(parseDistribution('-1,1,1,1,1,0')).toBeNull();
  });
});

describe('回合流程', () => {
  it('无血刃的一轮：白蔷薇确定存活，花苞进献祭区，幽魂回流版图旁', () => {
    let s = newGame();
    s = openRound(s);
    expect(s.phase).toBe('play');
    expect(s.modifiers.revealInOrder).toBe(true); // 水晶 2 = 顺序公开
    expect(s.playOrder).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);

    s = play(s, 0, roleCardId(s, 0, 'whiteRose'));
    s = play(s, 1, plainCardId(s, 1, 'believer'));
    s = pass(s, 2);
    s = play(s, 3, plainCardId(s, 3, 'believer'));
    s = play(s, 4, plainCardId(s, 4, 'ghost'));

    expect(s.lastReveal?.outcome).toBe('sacrifice');
    expect(s.zones.whiteRose).toHaveLength(1);
    expect(countBuds(s.zones.sacrifice)).toBe(2);
    expect(s.zones.death).toHaveLength(0);
    expect(s.zones.ghosts).toHaveLength(2); // 原本 1 枚 + 打出的 1 枚回流
    expect(s.round).toBe(2);
    expect(s.phase).toBe('magic');
    // 出牌情况两处都有：随「上一轮公开」下发（结构化）+ 公开日志一行
    expect(s.lastReveal?.coinHolder).toBe('p0');
    expect(playStatus(s)).toEqual([
      { id: 'p0', played: true },
      { id: 'p1', played: true },
      { id: 'p2', played: false },
      { id: 'p3', played: true },
      { id: 'p4', played: true },
    ]);
    expect(statusLine(s)).toBe(
      '第 1 轮出牌情况（自持币者 A 起顺时针）：A 已出牌、B 已出牌、C 跳过、D 已出牌、E 已出牌',
    );
    expect(statusLine(s)).not.toMatch(/幽魂|信者|白蔷薇|血刃/); // 只列状态，不泄露牌面
  });

  it('白蔷薇存活且献祭区达标时白蔷薇阵营获胜', () => {
    let s = newGame();
    s = openRound(s);
    s = play(s, 0, roleCardId(s, 0, 'whiteRose'));
    s = play(s, 1, plainCardId(s, 1, 'believer'));
    s = play(s, 2, plainCardId(s, 2, 'believer'));
    s = play(s, 3, plainCardId(s, 3, 'believer'));
    s = pass(s, 4);

    expect(s.winner).toBe('whiteRose');
    expect(s.phase).toBe('finished');
    expect(countBuds(s.zones.sacrifice)).toBe(3); // 5 人局阈值 3
  });

  it('死亡区花苞达标时血刃阵营获胜', () => {
    let s = newGame();
    s = openRound(s);
    s = play(s, 0, plainCardId(s, 0, 'believer'));
    s = play(s, 1, plainCardId(s, 1, 'believer'));
    s = play(s, 2, plainCardId(s, 2, 'believer'));
    s = play(s, 3, roleCardId(s, 3, 'doubleBlade')); // 血刃牌
    s = play(s, 4, plainCardId(s, 4, 'believer'));

    expect(s.lastReveal?.outcome).toBe('slain');
    expect(countBuds(s.zones.death)).toBe(4); // 5 人局阈值 4
    expect(s.winner).toBe('bloodBlade');
    expect(s.phase).toBe('finished');
  });

  it('血刃与白蔷薇同轮出现时立即判血刃胜', () => {
    let s = newGame();
    s = openRound(s);
    s = play(s, 0, roleCardId(s, 0, 'whiteRose'));
    s = pass(s, 1);
    s = pass(s, 2);
    s = play(s, 3, roleCardId(s, 3, 'doubleBlade'));
    s = pass(s, 4);

    expect(s.lastReveal?.outcome).toBe('whiteRoseKilled');
    expect(s.winner).toBe('bloodBlade');
  });

  it('无人出牌则跳过结算，直接进入下一轮', () => {
    let s = newGame();
    s = openRound(s);
    s = pass(s, 0);
    expect(s.passed['p0']).toBe(true); // 跳过会被记录
    expect(playerView(s, 'p1').players[0]!.passed).toBe(true); // 且是公开信息
    for (let seat = 1; seat < 5; seat++) s = pass(s, seat);

    expect(s.passed['p0']).toBe(false); // 进入新轮次后重置
    expect(s.lastReveal?.outcome).toBe('noCards');
    expect(s.round).toBe(2);
    expect(s.zones.sacrifice).toHaveLength(0);
    // 跳过结算的轮次同样记录名单并写日志（该轮「上一轮公开」面板不渲染）
    expect(playStatus(s)?.every((x) => !x.played)).toBe(true);
    expect(statusLine(s)).toBe('第 1 轮出牌情况（自持币者 A 起顺时针）：A 跳过、B 跳过、C 跳过、D 跳过、E 跳过');
  });

  it('水晶耗尽仍未达成条件时血刃阵营获胜', () => {
    let s = newGame({ crystals: { 0: 2, 1: 2, 2: 2, 3: 2, 4: 2 } });
    for (let round = 0; round < 5; round++) {
      const receiver = s.players.find((x) => !x.crystalPlaced)!;
      s = applyMove(s, { type: 'passCoin', playerId: s.coinHolder, to: receiver.id });
      while (s.phase === 'play') {
        s = applyMove(s, { type: 'passTurn', playerId: s.playOrder[s.turnIndex]! });
      }
    }
    expect(s.crystalsPlaced).toBe(5);
    expect(s.winner).toBe('bloodBlade');
    expect(s.winReason).toContain('水晶耗尽');
  });

  it('N 人局恰好 N 轮，每轮只发动一枚水晶且每人只发动一次', () => {
    let s = newGame({ crystals: { 0: 2, 1: 2, 2: 2, 3: 2, 4: 2 } });
    const totalRounds = s.playerCount;

    for (let round = 1; round <= totalRounds; round++) {
      expect(s.round).toBe(round);
      expect(s.crystalsPlaced).toBe(round - 1);

      const receiver = s.players.find((x) => !x.crystalPlaced)!;
      s = applyMove(s, { type: 'passCoin', playerId: s.coinHolder, to: receiver.id });
      expect(s.crystalsPlaced).toBe(round); // 每轮恰好放置一枚

      while (s.phase === 'play') {
        s = applyMove(s, { type: 'passTurn', playerId: s.playOrder[s.turnIndex]! });
      }
    }

    expect(s.round).toBe(totalRounds); // 第 N 轮结束即终止，不会出现第 N+1 轮
    expect(s.players.every((x) => x.crystalPlaced)).toBe(true); // 每枚水晶都只发动过一次
    expect(s.phase).toBe('finished');
  });
});

describe('魔法效果', () => {
  it('1 号效果：需要指定目标，被指定者回合不能跳过', () => {
    let s = newGame({ crystals: { 0: 1 } });
    s = openRound(s);
    expect(s.phase).toBe('magicTargets');
    expect(s.pendingMagic?.skill).toBe('forcePlay');
    expect(s.pendingMagic?.crystal).toBe(1);

    s = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1'] });
    expect(s.phase).toBe('play');
    expect(s.modifiers.mustPlay).toContain('p1');

    s = play(s, 0, plainCardId(s, 0, 'ghost'));
    expect(() => pass(s, 1)).toThrow();
  });

  it('1 号效果：不能指定自己（区别于 7 号）', () => {
    let s = newGame({ crystals: { 0: 1 } });
    s = openRound(s);
    expect(() =>
      applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p0'] }),
    ).toThrow();
  });

  it('7 号效果：直接新增一枚幽魂，不消耗弃牌堆，且可指定自己', () => {
    let s = newGame({ crystals: { 0: 7 } });
    const poolBefore = s.zones.ghosts.length; // 1：双刃换出的那张
    expect(p(s, 0).hand.filter((c) => c.kind === 'ghost')).toHaveLength(1);

    s = openRound(s);
    s = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p0'] });

    expect(p(s, 0).hand.filter((c) => c.kind === 'ghost')).toHaveLength(2); // 凭空多一张
    expect(s.zones.ghosts).toHaveLength(poolBefore); // 弃牌堆不受影响
  });

  it('3 号效果：右邻（逆时针下一位）被引擎强制随机出牌', () => {
    let s = newGame({ crystals: { 0: 3 } });
    s = openRound(s);
    expect(s.modifiers.mustPlayRandom).toContain('p4'); // p0 的逆时针下一位
    for (let seat = 0; seat < 4; seat++) s = pass(s, seat);
    // p4 无需操作，引擎自动代打
    expect(s.phase).toBe('magic');
    expect(s.lastReveal?.cards).toHaveLength(1);
  });

  it('4 号效果：左邻（顺时针下一位）被引擎强制随机出牌', () => {
    const s = openRound(newGame({ crystals: { 0: 4 } }));
    expect(s.modifiers.mustPlayRandom).toContain('p1'); // p0 的顺时针下一位
  });

  it('水晶编号直接指向技能：1 号与 12 号指向同一技能', () => {
    expect(skillOfCrystal(1)).toBe('forcePlay');
    expect(skillOfCrystal(12)).toBe('forcePlay');
    expect(skillOfCrystal(2)).toBe('revealInOrder');
    const forcePlayCrystals = Object.entries(CRYSTAL_TO_SKILL)
      .filter(([, skill]) => skill === 'forcePlay')
      .map(([crystal]) => Number(crystal));
    expect(forcePlayCrystals).toEqual([1, 12]);
  });

  it('10 号效果：由被指定的玩家自己换牌，原牌收回手中', () => {
    let s = newGame({ crystals: { 0: 10 } });
    s = openRound(s);
    expect(s.phase).toBe('play');
    s = play(s, 0, plainCardId(s, 0, 'believer'));
    const ghostId = plainCardId(s, 1, 'ghost');
    s = play(s, 1, ghostId);
    s = pass(s, 2);
    s = play(s, 3, plainCardId(s, 3, 'believer'));
    s = pass(s, 4);

    expect(s.phase).toBe('redraw');
    expect(s.modifiers.redrawOption).toBe('p0');

    const handBefore = p(s, 1).hand.length;
    s = applyMove(s, { type: 'resolveRedraw', playerId: 'p0', targetId: 'p1' });

    // 指定后挂起：已打出的牌仍在原位，等 p1 自己从剩余手牌中选一张完成对调
    expect(s.phase).toBe('play');
    expect(s.pendingRedraw).toBe('p1');
    expect(s.played['p1']?.id).toBe(ghostId);
    expect(s.passed['p1']).toBe(false); // 换牌挂起 ≠ 跳过
    expect(() => applyMove(s, { type: 'passTurn', playerId: 'p1' })).toThrow(); // 不能跳过
    expect(() => play(s, 1, ghostId)).toThrow(); // 原牌不在手牌中，不能换回同一张

    // p1 用信者与幽魂对调：信者参与本轮结算，幽魂回到手中
    const believerId = plainCardId(s, 1, 'believer');
    s = play(s, 1, believerId);
    expect(s.pendingRedraw).toBeNull();
    expect(s.lastReveal?.byPlayer['p1']?.id).toBe(believerId); // 换上的牌参与结算
    expect(s.lastReveal?.cards.map((c) => c.id)).not.toContain(ghostId); // 幽魂没有被公开
    expect(p(s, 1).hand.map((c) => c.id)).toContain(ghostId); // 幽魂回到手中
    expect(p(s, 1).hand.length).toBe(handBefore); // 手牌不减少：对调而非丢弃
    expect(s.round).toBe(2);
    expect(countBuds(s.zones.sacrifice)).toBe(3); // p0、p1（换入）、p3 的信者牌
  });

  it('10 号效果：不能指定没有出牌或没有剩余手牌的玩家', () => {
    let s = newGame({ crystals: { 0: 10 } });
    s = openRound(s);
    s = play(s, 0, plainCardId(s, 0, 'believer'));
    s = pass(s, 1);
    s = pass(s, 2);
    s = play(s, 3, plainCardId(s, 3, 'believer'));
    s = pass(s, 4);
    expect(s.phase).toBe('redraw');
    // p1 本轮跳过，不能作为换牌目标
    expect(() =>
      applyMove(s, { type: 'resolveRedraw', playerId: 'p0', targetId: 'p1' }),
    ).toThrow();
  });

  it('9 号效果：暗刃只知道哪些人是白蔷薇与司教，不知道具体身份', () => {
    let s = newGame({ crystals: { 0: 9 } });
    s = openRound(s);
    const knowledge = s.knowledge['p4']!;
    const scouted = knowledge.find((k) => k.kind === 'scoutedRoles');
    expect(scouted && scouted.kind === 'scoutedRoles' ? scouted.players : []).toEqual(['p0', 'p1']);
    // 情报本身不得携带角色，否则等于泄露「谁是白蔷薇、谁是司教」
    expect(JSON.stringify(scouted)).not.toContain('whiteRose');
  });

  it('1 号与 12 号行为完全一致', () => {
    let s = newGame({ crystals: { 0: 12 } });
    s = openRound(s);
    expect(s.phase).toBe('magicTargets');
    expect(s.pendingMagic?.skill).toBe('forcePlay');
    s = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1'] });
    expect(s.modifiers.mustPlay).toContain('p1');
  });

  it('2 号效果：本轮顺序公开，出牌顺序即公开顺序', () => {
    let s = newGame({ crystals: { 0: 2 } });
    s = openRound(s);
    s = pass(s, 0);
    s = play(s, 1, plainCardId(s, 1, 'believer'));
    s = pass(s, 2);
    s = pass(s, 3);
    s = play(s, 4, plainCardId(s, 4, 'ghost'));
    expect(s.lastReveal?.attributed).toBe(true);
    expect(s.lastReveal?.cards).toHaveLength(2);
    // 顺序公开时，数组顺序就是实际出牌顺序
    expect(s.lastReveal?.cards[0]?.id).toBe(s.lastReveal?.byPlayer['p1']?.id);
    expect(s.lastReveal?.cards[1]?.id).toBe(s.lastReveal?.byPlayer['p4']?.id);
  });

  it('出牌情况从持币者起按座位顺序列出，与出牌顺序无关', () => {
    let s = newGame({ crystals: { 2: 2 } });
    // 硬币交给 C（座位 3），其水晶为 2 号（顺序公开，不产生任何出牌约束）
    s = applyMove(s, { type: 'passCoin', playerId: 'p0', to: 'p2' });
    expect(s.playOrder).toEqual(['p2', 'p3', 'p4', 'p0', 'p1']);
    s = pass(s, 2);
    s = play(s, 3, plainCardId(s, 3, 'believer'));
    s = pass(s, 4);
    s = pass(s, 0);
    s = pass(s, 1);

    expect(s.lastReveal?.outcome).toBe('sacrifice');
    expect(s.lastReveal?.coinHolder).toBe('p2');
    expect(playStatus(s)).toEqual([
      { id: 'p2', played: false },
      { id: 'p3', played: true },
      { id: 'p4', played: false },
      { id: 'p0', played: false },
      { id: 'p1', played: false },
    ]);
    expect(statusLine(s)).toBe(
      '第 1 轮出牌情况（自持币者 C 起顺时针）：C 跳过、D 已出牌、E 跳过、A 跳过、B 跳过',
    );
  });

  it('非 2 号效果时公开是匿名的', () => {
    let s = newGame({ crystals: { 0: 10 } });
    s = openRound(s);
    s = play(s, 0, plainCardId(s, 0, 'believer'));
    for (let seat = 1; seat < 5; seat++) s = pass(s, seat);
    s = applyMove(s, { type: 'resolveRedraw', playerId: 'p0' }); // 放弃换牌
    expect(s.lastReveal?.attributed).toBe(false);
  });
});

describe('技能边界', () => {
  describe('5 号：行动绑定', () => {
    it('先行动者出牌时，后行动者不能跳过', () => {
      let s = newGame({ crystals: { 0: 5 } });
      s = openRound(s);
      // 故意颠倒指定顺序，绑定关系应由出牌顺序决定而非指定顺序
      s = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p3', 'p1'] });
      s = pass(s, 0);
      s = play(s, 1, plainCardId(s, 1, 'believer'));
      expect(s.modifiers.mustPlay).toContain('p3');
      s = pass(s, 2);
      expect(() => pass(s, 3)).toThrow();
    });

    it('先行动者跳过时，后行动者也被绑定为跳过', () => {
      let s = newGame({ crystals: { 0: 5 } });
      s = openRound(s);
      s = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1', 'p3'] });
      s = pass(s, 0);
      expect(s.passed['p0']).toBe(true);
      expect(s.passed['p1']).toBe(false); // 尚未行动不算跳过
      s = pass(s, 1);
      expect(s.modifiers.mustPass).toContain('p3');
      s = pass(s, 2);
      expect(() => play(s, 3, plainCardId(s, 3, 'believer'))).toThrow();
    });

    it('必须指定两名有手牌的其他玩家', () => {
      const s = openRound(newGame({ crystals: { 0: 5 } }));
      const resolve = (targets: string[]) =>
        applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets });
      expect(() => resolve(['p1'])).toThrow(); // 人数不足
      expect(() => resolve(['p1', 'p1'])).toThrow(); // 重复指定
      expect(() => resolve(['p0', 'p1'])).toThrow(); // 不能指定自己
    });
  });

  describe('6 号：殿后', () => {
    it('选择殿后后移到队尾，轮次轮到下一位', () => {
      let s = newGame({ crystals: { 0: 6 } });
      s = openRound(s);
      expect(s.phase).toBe('play');
      expect(s.modifiers.goLastOption).toBe('p0');
      expect(s.playOrder).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);

      s = applyMove(s, { type: 'chooseGoLast', playerId: 'p0' });
      expect(s.playOrder).toEqual(['p1', 'p2', 'p3', 'p4', 'p0']);
      expect(s.playOrder[s.turnIndex]).toBe('p1');
      expect(s.modifiers.goLastUsed).toBe(true);
    });

    it('只有水晶持有者能选择殿后', () => {
      const s = openRound(newGame({ crystals: { 0: 6 } }));
      expect(() => applyMove(s, { type: 'chooseGoLast', playerId: 'p2' })).toThrow();
    });

    it('殿后者最后行动，行动序列里排在最后', () => {
      let s = newGame({ crystals: { 0: 6 } });
      s = openRound(s);
      s = applyMove(s, { type: 'chooseGoLast', playerId: 'p0' });
      expect(s.playOrder[s.turnIndex]).toBe('p1');

      s = play(s, 1, plainCardId(s, 1, 'believer'));
      s = play(s, 2, plainCardId(s, 2, 'believer'));
      s = play(s, 3, plainCardId(s, 3, 'believer'));
      s = play(s, 4, plainCardId(s, 4, 'believer'));

      // 四人行动完才轮到殿后者
      expect(s.phase).toBe('play');
      expect(s.playSequence).toEqual(['p1', 'p2', 'p3', 'p4']); // 殿后者尚未行动
      expect(s.playOrder[s.turnIndex]).toBe('p0');
      s = play(s, 0, plainCardId(s, 0, 'believer'));
      expect(s.round).toBe(2); // 殿后完成后本轮结束
    });
  });

  describe('8 号：两邻出牌', () => {
    it('左邻与右邻都必须在自己的回合出牌', () => {
      let s = newGame({ crystals: { 0: 8 } });
      s = openRound(s);
      expect(s.modifiers.mustPlay).toEqual(['p1', 'p4']); // 左邻 p1、右邻 p4
      s = pass(s, 0);
      expect(() => pass(s, 1)).toThrow();
      s = play(s, 1, plainCardId(s, 1, 'believer'));
      s = pass(s, 2);
      s = pass(s, 3);
      expect(() => pass(s, 4)).toThrow();
    });
  });

  describe('11 号：窥牌', () => {
    it('随机查看目标一张手牌，且只有自己知道', () => {
      let s = newGame({ crystals: { 0: 11 } });
      s = openRound(s);
      expect(s.phase).toBe('magicTargets');
      s = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p2'] });

      const peeked = s.knowledge['p0']!.filter((k) => k.kind === 'peekedCard');
      expect(peeked).toHaveLength(1);
      const info = peeked[0]!;
      if (info.kind !== 'peekedCard') throw new Error('知识类型错误');
      expect(info.target).toBe('p2');
      // 看到的确实是对手手里的一张牌
      expect(p(s, 2).hand.some((c) => c.id === info.card.id)).toBe(true);
      // 隐私：被查看者拿不到任何窥牌知识
      expect(playerView(s, 'p2').knowledge).toHaveLength(0);
      expect(playerView(s, 'p1').knowledge.filter((k) => k.kind === 'peekedCard')).toHaveLength(0);
    });
  });

  describe('7 号：新增幽魂', () => {
    const ghostCount = (s: GameState, seat: number) =>
      p(s, seat).hand.filter((c) => c.kind === 'ghost').length;

    it('直接新增一张幽魂且不扣减弃牌堆；打出的幽魂仍回流弃牌堆', () => {
      let s = newGame({ crystals: { 0: 7 } });
      const poolBefore = s.zones.ghosts.length;
      expect(ghostCount(s, 2)).toBe(1);

      s = openRound(s);
      s = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p2'] });

      expect(ghostCount(s, 2)).toBe(2); // 原本 1 张 + 新增 1 张
      expect(s.zones.ghosts).toHaveLength(poolBefore); // 弃牌堆不变

      s = play(s, 0, plainCardId(s, 0, 'believer'));
      s = play(s, 1, plainCardId(s, 1, 'believer'));
      s = play(s, 2, plainCardId(s, 2, 'ghost'));
      s = pass(s, 3);
      s = pass(s, 4);

      expect(s.zones.ghosts).toHaveLength(poolBefore + 1); // 打出的幽魂回流
      expect(ghostCount(s, 2)).toBe(1);
    });

    it('可以指定自己', () => {
      let s = newGame({ crystals: { 0: 7 } });
      s = openRound(s);
      s = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p0'] });
      expect(ghostCount(s, 0)).toBe(2);
    });
  });

  describe('每轮只有一个技能生效', () => {
    it('上一轮的出牌约束会在新轮次清空', () => {
      let s = newGame({ crystals: { 0: 8, 1: 2, 2: 2, 3: 2, 4: 2 } });
      s = openRound(s);
      expect(s.modifiers.mustPlay).toEqual(['p1', 'p4']);

      s = pass(s, 0);
      s = play(s, 1, plainCardId(s, 1, 'believer'));
      s = pass(s, 2);
      s = pass(s, 3);
      s = play(s, 4, plainCardId(s, 4, 'believer'));
      expect(s.round).toBe(2);

      // 第 2 轮由 p1 发动 2 号效果，上一轮的约束不应残留
      s = applyMove(s, { type: 'passCoin', playerId: s.coinHolder, to: 'p1' });
      expect(s.modifiers.mustPlay).toEqual([]);
      expect(s.modifiers.mustPlayRandom).toEqual([]);
      expect(s.modifiers.mustPass).toEqual([]);
      expect(s.modifiers.pairs).toEqual([]);
      expect(s.modifiers.revealInOrder).toBe(true); // 本轮才是 2 号
    });
  });
});

describe('playerView 隐藏信息', () => {
  it('只下发自己的角色、阵营、手牌与水晶', () => {
    const s = newGame();
    const mine = playerView(s, 'p0');
    const self = mine.players[0]!;
    expect(self.role).toBe('whiteRose');
    expect(self.faction).toBe('whiteRose');
    expect(self.hand).toHaveLength(3);
    expect(self.crystal).toBe(2);

    const other = mine.players[4]!;
    expect(other.role).toBeUndefined();
    expect(other.faction).toBeUndefined();
    expect(other.hand).toBeUndefined();
    expect(other.crystal).toBeUndefined();
    expect(other.handCount).toBe(3);
  });

  it('知识只下发本人那一份', () => {
    const s = newGame();
    expect(playerView(s, 'p0').knowledge).toHaveLength(1); // 互认名单
    expect(playerView(s, 'p4').knowledge).toHaveLength(0); // 暗刃未睁眼
  });

  it('匿名公开时不下发谁出了什么', () => {
    let s = newGame({ crystals: { 0: 10 } });
    s = openRound(s);
    s = play(s, 0, plainCardId(s, 0, 'believer'));
    for (let seat = 1; seat < 5; seat++) s = pass(s, seat);
    s = applyMove(s, { type: 'resolveRedraw', playerId: 'p0' }); // 放弃换牌

    expect(s.lastReveal?.attributed).toBe(false);
    const view = playerView(s, 'p1');
    expect(view.lastReveal?.cards).toHaveLength(1);
    expect(Object.keys(view.lastReveal?.byPlayer ?? {})).toHaveLength(0);
    // 匿名公开同样记录出牌情况（面板 + 日志两处，只列状态，不泄露谁出了什么）
    expect(playStatus(s)).toEqual([
      { id: 'p0', played: true },
      { id: 'p1', played: false },
      { id: 'p2', played: false },
      { id: 'p3', played: false },
      { id: 'p4', played: false },
    ]);
    const line = statusLine(s)!;
    expect(line).toContain('自持币者 A 起顺时针');
    expect(line).toContain('A 已出牌');
    for (const name of ['B', 'C', 'D', 'E']) expect(line).toContain(`${name} 跳过`);
    expect(line).not.toMatch(/幽魂|信者|白蔷薇|血刃/); // 只列状态，不泄露牌面
    expect(playerView(s, 'p3').lastReveal?.playStatus).toHaveLength(5); // 公开信息，随视图下发
  });

  it('顺序公开时才下发谁出了什么', () => {
    let s = newGame({ crystals: { 0: 2 } });
    s = openRound(s);
    s = pass(s, 0);
    s = play(s, 1, plainCardId(s, 1, 'believer'));
    for (const seat of [2, 3, 4]) s = pass(s, seat);

    const view = playerView(s, 'p0');
    expect(view.lastReveal?.attributed).toBe(true);
    expect(view.lastReveal?.byPlayer['p1']).toBeDefined();
  });

  it('公开区域与阈值对所有人可见', () => {
    const view = playerView(newGame(), 'p2');
    expect(view.thresholds).toEqual({ sacrifice: 3, death: 4 });
    expect(view.zones.whiteRose).toEqual([]);
    expect(view.crystalsPlaced).toBe(0);
    // 血刃牌总数 = 双刃 + 暗刃 + 夜晚换入版图旁的那张双刃牌
    expect(view.cardTotals).toEqual({ whiteRose: 1, blade: 3 });
  });
});

describe('不可变与可复现', () => {
  it('applyMove 不修改传入的状态', () => {
    const s = newGame();
    const before = JSON.stringify(s);
    applyMove(s, { type: 'passCoin', playerId: 'p0', to: 'p0' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('相同种子产生相同的初始局面', () => {
    const a = newGame();
    const b = newGame();
    const strip = (s: GameState) => ({
      roles: s.players.map((x) => x.role),
      crystals: s.players.map((x) => x.crystal),
      coin: s.coinHolder,
    });
    expect(strip(a)).toEqual(strip(b));
  });

  it('未轮到行动的玩家不能出牌', () => {
    const s = openRound(newGame());
    expect(() => play(s, 3, plainCardId(s, 3, 'believer'))).toThrow();
  });

  it('手牌中不存在的牌不能出', () => {
    const s = openRound(newGame());
    expect(() => play(s, 0, 'not-a-real-card')).toThrow();
  });

  it('只有水晶尚未放出的玩家可以接受硬币', () => {
    let s = openRound(newGame());
    // 第一轮已由 p0 放完水晶；轮到 p0 传币时不能再传给自己
    for (let seat = 0; seat < 5; seat++) s = pass(s, seat);
    expect(() => applyMove(s, { type: 'passCoin', playerId: 'p0', to: 'p0' })).toThrow();
  });
});

describe('类型辅助', () => {
  it('花苞计数只认司教与信者', () => {
    const cards: Card[] = [
      { id: 'a', kind: 'role', role: 'bishop' },
      { id: 'b', kind: 'role', role: 'believer' },
      { id: 'c', kind: 'believer' },
      { id: 'd', kind: 'role', role: 'whiteRose' },
      { id: 'e', kind: 'role', role: 'doubleBlade' },
      { id: 'f', kind: 'ghost' },
    ];
    expect(countBuds(cards)).toBe(3);
  });
});
