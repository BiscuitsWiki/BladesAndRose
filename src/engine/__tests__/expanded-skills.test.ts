import { describe, expect, it } from 'vitest';
import {
  LOADOUT_2025,
  applyMove,
  autoMoveFor,
  createGame,
  playerView,
  type Card,
  type GameState,
  type Role,
  type SetupOptions,
} from '../index';

const NAMES = ['A', 'B', 'C', 'D', 'E'];

/** 5 人局固定角色，方便精确控制（p1 = 司教，供 8 号扩充用） */
const ROLES_5: Record<number, Role> = {
  0: 'whiteRose',
  1: 'bishop',
  2: 'believer',
  3: 'doubleBlade',
  4: 'darkBlade',
};

const NAMES8 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const ROLES_8: Record<number, Role> = {
  0: 'whiteRose',
  1: 'bishop',
  2: 'believer',
  3: 'believer',
  4: 'believer',
  5: 'greatBlade',
  6: 'doubleBlade',
  7: 'darkBlade',
};

/** 以 2025 扩充包技能组建局；crystals:{0:N} 指定座位 0 的水晶编号 */
function game(over: Partial<SetupOptions> = {}): GameState {
  return createGame(NAMES, { seed: 42, roles: ROLES_5, coinSeat: 0, loadout: LOADOUT_2025, ...over });
}

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;
const id = (s: GameState, seat: number): string => s.players[seat]!.id;
const p = (s: GameState, seat: number) => s.players[seat]!;

function cardOf(s: GameState, seat: number, kind: 'ghost' | 'believer'): Card {
  const card = p(s, seat).hand.find((c) => c.kind === kind);
  if (!card) throw new Error(`座位 ${seat} 手中没有 ${kind}`);
  return card;
}

/** 让 p0 把硬币交给自己：翻开指定水晶并结算技能 */
function open(s: GameState): GameState {
  return applyMove(s, { type: 'passCoin', playerId: id(s, 0), to: id(s, 0) });
}
const pass = (s: GameState, seat: number) => applyMove(s, { type: 'passTurn', playerId: id(s, seat) });
const playKind = (s: GameState, seat: number, kind: 'ghost' | 'believer') =>
  applyMove(s, { type: 'playCard', playerId: id(s, seat), cardId: cardOf(s, seat, kind).id });

/** 从座位 1 起全员依次跳过（座位 0 已由用例处理） */
function passRest(s: GameState, from = 1): GameState {
  let cur = s;
  for (let seat = from; seat < cur.playerCount; seat++) cur = pass(cur, seat);
  return cur;
}

describe('扩充 2 号：禁止出牌（forcePass）', () => {
  it('5 人局指定 1 人：引擎自动跳过被指定者，出牌守卫仍然生效', () => {
    let s = open(game({ crystals: { 0: 2 } }));
    expect(s.phase).toBe('magicTargets');
    s = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1'] });
    expect(s.modifiers.mustPass).toEqual(['p1']);
    s = pass(s, 0); // p0 跳过 → p1 被禁止出牌：引擎直接自动跳过，不询问
    expect(s.passed['p1']).toBe(true);
    // 守卫：即便伪造状态把 p1 放到行动位，出牌也会被拒
    const forced: GameState = { ...s, phase: 'play', playOrder: ['p1'], turnIndex: 0 };
    expect(() =>
      applyMove(forced, { type: 'playCard', playerId: 'p1', cardId: cardOf(s, 1, 'believer').id }),
    ).toThrow('本回合必须跳过');
  });

  it('8 人局必须指定 2 人', () => {
    const s8 = open(
      createGame(NAMES8, { seed: 1, roles: ROLES_8, coinSeat: 0, loadout: LOADOUT_2025, crystals: { 0: 2 } }),
    );
    expect(s8.phase).toBe('magicTargets');
    expect(() =>
      applyMove(s8, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1'] }),
    ).toThrow('该技能需要指定 2 名玩家');
    const done = applyMove(s8, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1', 'p2'] });
    expect(done.modifiers.mustPass).toEqual(['p1', 'p2']);
  });

  it('目标不能重复或选自己', () => {
    const s = open(game({ crystals: { 0: 2 } }));
    expect(() =>
      applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p0'] }),
    ).toThrow('目标不合法');
    const s8 = open(
      createGame(NAMES8, { seed: 1, roles: ROLES_8, coinSeat: 0, loadout: LOADOUT_2025, crystals: { 0: 2 } }),
    );
    expect(() =>
      applyMove(s8, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1', 'p1'] }),
    ).toThrow();
  });
});

describe('扩充 3 号：随机出牌（randomPlay）', () => {
  it('显式选牌被拒；playRandom 从手牌随机抽且同种子可复现', () => {
    const s = open(game({ crystals: { 0: 3 } }));
    expect(s.modifiers.randomPlay).toBe(true);
    expect(() => playKind(s, 0, 'believer')).toThrow('请使用「随机出牌」');

    /** 走一遍随机出牌，返回被抽中牌在原手牌中的位置（用来对比两次运行的确定性） */
    const run = () => {
      const before = open(game({ crystals: { 0: 3 } }));
      const hand = p(before, 0).hand.map((c) => c.id);
      const after = applyMove(before, { type: 'playRandom', playerId: 'p0' });
      const drawn = after.played['p0']!;
      expect(hand.includes(drawn.id)).toBe(true); // 牌来自手牌
      expect(after.players[0]!.hand.some((c) => c.id === drawn.id)).toBe(false); // 已从手牌移出
      expect(after.log.some((l) => l.includes('随机出了一张牌'))).toBe(true);
      return hand.indexOf(drawn.id);
    };
    // 同一 seed 的开局与抽牌完全一致（牌 id 因全局计数不同，比较位置）
    expect(run()).toBe(run());
  });

  it('仍可自愿跳过；非随机回合不能调用 playRandom', () => {
    let s = open(game({ crystals: { 0: 3 } }));
    s = pass(s, 0);
    expect(s.passed['p0']).toBe(true);

    const normal = open(game({ crystals: { 0: 2 } }));
    const t = applyMove(normal, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1'] });
    expect(() => applyMove(t, { type: 'playRandom', playerId: 'p0' })).toThrow('本轮不是随机出牌回合');
  });
});

describe('扩充 4 号：两圈出牌（twoLapPlay）', () => {
  it('同一玩家两圈各出一张，公开汇总全部牌、逐人呈现', () => {
    let s = open(game({ crystals: { 0: 4 } }));
    expect(s.modifiers.laps).toBe(2);
    expect(s.lap).toBe(1);

    s = playKind(s, 0, 'believer'); // 第 1 圈：p0 出一张
    s = passRest(s); // 其余人跳过 → 进入第 2 圈
    expect(s.lap).toBe(2);
    expect(s.log.some((l) => l.includes('本轮出牌进入第 2 圈'))).toBe(true);

    s = playKind(s, 0, 'ghost'); // 第 2 圈：p0 再出一张（每人每圈一次机会）
    s = playKind(s, 1, 'believer'); // 第 1 圈跳过过的玩家，第 2 圈仍可出牌
    // 阶段尚未收束（p2~p4 还没行动），可先检查两圈的出牌记录
    expect(s.played['p0']!.kind).toBe('believer');
    expect(s.extraPlays['p0']!.length).toBe(1);

    s = passRest(s, 2);
    expect(s.lastReveal!.cards.length).toBe(3); // p0 两张 + p1 一张
    expect(s.lastReveal!.playStatus.find((x) => x.id === 'p0')!.played).toBe(true);
    expect(s.log.some((l) => l.includes('公开 3 张牌'))).toBe(true);
  });

  it('每人每圈只有一次机会：两圈走完立即收束', () => {
    let s = open(game({ crystals: { 0: 4 } }));
    s = passRest(s, 0); // 第 1 圈全员依次跳过（从 p0 起）
    expect(s.lap).toBe(2);
    s = passRest(s, 0); // 第 2 圈全员跳过
    expect(s.phase).toBe('magic'); // 已进入下一轮
    expect(s.lastReveal!.outcome).toBe('noCards');
  });
});

describe('扩充 5 号：同出（trioPlay）', () => {
  it('必选 min(2,池) 人；集合内必各出 1 张，集合外自动跳过', () => {
    let s = open(game({ crystals: { 0: 5 } }));
    expect(s.phase).toBe('magicTargets');
    expect(() =>
      applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1'] }),
    ).toThrow('该技能需要指定 2 名玩家');

    s = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1', 'p2'] });
    expect(s.modifiers.trio).toEqual(['p0', 'p1', 'p2']);
    expect(s.modifiers.mustPlay).toEqual(['p0', 'p1', 'p2']);
    expect(s.playOrder).toEqual(['p0', 'p1', 'p2']); // 集合外玩家不进顺序

    expect(() => pass(s, 0)).toThrow('本回合必须出牌');
    s = playKind(s, 0, 'believer');
    s = playKind(s, 1, 'believer');
    s = playKind(s, 2, 'believer');
    expect(s.lastReveal!.cards.length).toBe(3);
    expect(s.lastReveal!.playStatus.filter((x) => x.played).map((x) => x.id)).toEqual([
      'p0',
      'p1',
      'p2',
    ]);
  });

  it('池为空时自动结算：集合只剩自己（若有牌），不进入目标选择', () => {
    const t = clone(game({ crystals: { 0: 5 } }));
    t.players.forEach((pl, i) => {
      if (i !== 0) pl.hand = [];
    });
    const s = open(t);
    // 目标池为空时按空目标自动结算，不再等待玩家确认（否则会卡在目标选择）
    expect(s.phase).toBe('play');
    expect(s.pendingMagic).toBeNull();
    expect(s.modifiers.trio).toEqual(['p0']);
    expect(s.playOrder).toEqual(['p0']);
  });

  it('自己无手牌则不进集合', () => {
    const t = clone(game({ crystals: { 0: 5 } }));
    t.players[0]!.hand = [];
    const s = open(t);
    const done = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1', 'p2'] });
    expect(done.modifiers.trio).toEqual(['p1', 'p2']);
    expect(done.playOrder).toEqual(['p1', 'p2']);
  });

  it('集合为空则按无人出牌轮处理', () => {
    const t = clone(game({ crystals: { 0: 5 } }));
    t.players.forEach((pl) => {
      pl.hand = [];
    });
    const s = open(t);
    // 空目标自动结算 → 集合为空即无人出牌轮：直接结算并进入下一轮
    expect(s.lastReveal!.outcome).toBe('noCards');
    expect(s.log.some((l) => l.includes('无人可以出牌'))).toBe(true);
    expect(s.round).toBe(2);
  });
});

describe('扩充 6 号：洗牌前补出（preShufflePick）', () => {
  it('全员跳过后进入补出决策；指定者随机补出一张（匿名）', () => {
    let s = open(game({ crystals: { 0: 6 } }));
    expect(s.modifiers.pendingPick?.chooser).toBe('p0');

    s = passRest(s, 0);
    expect(s.phase).toBe('prePick');
    expect(s.modifiers.pendingPick!.pool).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    expect(() =>
      applyMove(s, { type: 'pickPreShuffleTarget', playerId: 'p0', targetId: 'p9' }),
    ).toThrow('目标不合法');

    s = applyMove(s, { type: 'pickPreShuffleTarget', playerId: 'p0', targetId: 'p1' });
    expect(s.lastReveal!.cards.length).toBe(1);
    expect(s.lastReveal!.playStatus.find((x) => x.id === 'p1')!.played).toBe(true);
    expect(s.log.some((l) => l.includes('补出一张牌'))).toBe(true);
  });

  it('池空则无事发生：不进入决策，直接按无人出牌轮结算', () => {
    const t = clone(game({ crystals: { 0: 6 } }));
    t.players.forEach((pl) => {
      pl.hand = [];
    });
    const s = open(t);
    expect(s.log.some((l) => l.includes('已无未出牌且有手牌'))).toBe(true);
    expect(s.lastReveal!.outcome).toBe('noCards');
  });
});

describe('扩充 7 号：殿后（复用初版 goLast）', () => {
  it('持有者可选择最后行动', () => {
    let s = open(game({ crystals: { 0: 7 } }));
    expect(s.modifiers.goLastOption).toBe('p0');
    s = applyMove(s, { type: 'chooseGoLast', playerId: 'p0' });
    expect(s.playOrder.at(-1)).toBe('p0');
    expect(s.modifiers.goLastUsed).toBe(true);
  });
});

describe('扩充 8 号：司教无保留（bishopMustPlay）', () => {
  it('司教持牌不得跳过，必须出牌', () => {
    let s = open(game({ crystals: { 0: 8 } }));
    expect(s.modifiers.bishopMustPlay).toBe(true);
    s = pass(s, 0); // p0（白蔷薇）可跳过
    expect(() => pass(s, 1)).toThrow('本回合必须出牌'); // p1 是司教
    s = playKind(s, 1, 'believer');
    expect(s.played['p1']).not.toBeNull();
  });

  it('司教无手牌时不受约束（自动跳过）', () => {
    const t = clone(game({ crystals: { 0: 8 } }));
    t.players[1]!.hand = [];
    let s = open(t);
    s = pass(s, 0);
    expect(s.passed['p1']).toBe(true); // 无手牌 → 引擎自动跳过，未报错
  });

  it('任何公开信息都不指向司教座位（日志与视图）', () => {
    let s = open(game({ crystals: { 0: 8 } }));
    s = pass(s, 0);
    s = playKind(s, 1, 'believer');

    // 提到「司教」的日志只有技能名 / 规则文案本身，没有任何一行把它与某个玩家连起来
    const linesAboutBishop = s.log.filter((l) => l.includes('司教'));
    expect(linesAboutBishop.length).toBeGreaterThan(0); // 规则文案本身公开
    for (const line of linesAboutBishop) expect(line).toContain('司教无保留');
    // 非司教视角的视图不出现任何 bishop 角色
    const view = playerView(s, 'p2');
    expect(view.players.some((x) => x.role === 'bishop')).toBe(false);
    expect(JSON.stringify(view)).not.toContain('"bishop"');
  });

  it('托管司教持牌时强制出牌', () => {
    let s = open(game({ crystals: { 0: 8 } }));
    s = pass(s, 0);
    const move = autoMoveFor(s, 'p1', () => 0);
    expect(move?.type).toBe('playCard');
  });
});

describe('扩充 9 号：禁幽魂（noGhost）', () => {
  it('幽魂一律不可出，其他牌正常', () => {
    let s = open(game({ crystals: { 0: 9 } }));
    expect(s.modifiers.noGhost).toBe(true);
    expect(() => playKind(s, 0, 'ghost')).toThrow('本轮不能打出幽魂牌');
    s = playKind(s, 0, 'believer');
    expect(s.played['p0']!.kind).toBe('believer');
  });

  it('夜换与技能途径获得的幽魂同样不可出', () => {
    const s = open(game({ crystals: { 0: 9 } }));
    const t = clone(s);
    t.players[0]!.hand.push({ id: 'ghost-extra', kind: 'ghost' });
    expect(() =>
      applyMove(t, { type: 'playCard', playerId: 'p0', cardId: 'ghost-extra' }),
    ).toThrow('本轮不能打出幽魂牌');
  });
});

describe('扩充 10 号：三张即开（earlyReveal）', () => {
  it('第 3 张落牌立即收束，未行动者不再询问', () => {
    let s = open(game({ crystals: { 0: 10 } }));
    expect(s.modifiers.revealAtCount).toBe(3);
    s = playKind(s, 0, 'believer');
    s = playKind(s, 1, 'believer');
    s = playKind(s, 2, 'believer');
    // 第三张落牌后立即混洗公开，p3/p4 未被询问
    expect(s.lastReveal!.cards.length).toBe(3);
    expect(s.lastReveal!.playStatus.filter((x) => x.played).map((x) => x.id)).toEqual([
      'p0',
      'p1',
      'p2',
    ]);
    expect(s.phase).toBe('magic');
  });
});

describe('扩充版复用的初版技能（forcePlay）', () => {
  it('1 号与 12 号在扩充表下仍是强制出牌', () => {
    let s = open(game({ crystals: { 0: 1 } }));
    expect(s.phase).toBe('magicTargets');
    s = applyMove(s, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p2'] });
    expect(s.modifiers.mustPlay).toEqual(['p2']);

    let s12 = open(game({ crystals: { 0: 12 } }));
    s12 = applyMove(s12, { type: 'resolveMagicTargets', playerId: 'p0', targets: ['p3'] });
    expect(s12.modifiers.mustPlay).toEqual(['p3']);
  });
});

describe('托管（autoMoveFor）覆盖扩充技能', () => {
  it('3 号轮：托管者直接随机出牌', () => {
    const s = open(game({ crystals: { 0: 3 } }));
    const move = autoMoveFor(s, 'p0', () => 0);
    expect(move).toEqual({ type: 'playRandom', playerId: 'p0' });
    const next = applyMove(s, move!);
    expect(next.played['p0']).not.toBeNull();
  });

  it('5 号轮：从目标池随机选足人数', () => {
    const s = open(game({ crystals: { 0: 5 } }));
    const move = autoMoveFor(s, 'p0', () => 0);
    expect(move).toEqual({ type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1', 'p2'] });
  });

  it('6 号轮：托管 chooser 从池中随机指定', () => {
    let s = open(game({ crystals: { 0: 6 } }));
    s = passRest(s, 0);
    expect(s.phase).toBe('prePick');
    const move = autoMoveFor(s, 'p0', () => 0);
    expect(move).toEqual({ type: 'pickPreShuffleTarget', playerId: 'p0', targetId: 'p0' });
  });

  it('2 号轮（8 人局）：一次选足 2 人', () => {
    const s8 = open(
      createGame(NAMES8, { seed: 1, roles: ROLES_8, coinSeat: 0, loadout: LOADOUT_2025, crystals: { 0: 2 } }),
    );
    const move = autoMoveFor(s8, 'p0', () => 0);
    expect(move).toEqual({ type: 'resolveMagicTargets', playerId: 'p0', targets: ['p1', 'p2'] });
  });
});