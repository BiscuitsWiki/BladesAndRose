import { describe, expect, it } from 'vitest';
import {
  FACTION_OF,
  ROLE_LABEL,
  ROLE_ORDER,
  createGame,
  playerView,
  type Card,
  type GameView,
  type Role,
} from '../../engine';
import { cardLabel } from '../cards';
import { cardFaceOf, seatLayout, seatVisualOf, topRowFits } from '../scene';

const COUNTS = [5, 6, 7, 8, 9, 10];

/** 真实建一局并取一位玩家的视图，避免手工拼 GameView 字面量 */
function baseView(count = 5, viewer = 'p0'): GameView {
  const names = Array.from({ length: count }, (_, i) => `P${i + 1}`);
  return playerView(createGame(names, { seed: 7 }), viewer);
}

/** 递归冻结：纯函数若试图写入会直接抛错（ESM 严格模式） */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}

describe('席位分布（seatLayout）——竖版三行牌桌', () => {
  it('5–10 人 × 每个视角：长度正确、座位号唯一、自己恒独占底行', () => {
    for (const count of COUNTS) {
      for (let self = 0; self < count; self++) {
        const slots = seatLayout(self, count);
        expect(slots).toHaveLength(count);
        expect(new Set(slots.map((slot) => slot.id)).size).toBe(count);
        expect(slots[0]).toEqual({ id: String(self), zone: 'bottom', col: 0, rowSize: 1 });
      }
    }
  });

  it('分布形态：5 人 顶2、6 人 顶3、7 人 顶2、8 人 顶3、9 人 顶2、10 人 顶3；左右各 1（5–6 人）、各 2（7–8 人）或各 3（9–10 人）；底行恒 1', () => {
    const zoneSizes = (count: number) => {
      const slots = seatLayout(0, count);
      const size = (zone: string) => slots.filter((slot) => slot.zone === zone).length;
      return { top: size('top'), left: size('left'), right: size('right'), bottom: size('bottom') };
    };
    expect(zoneSizes(5)).toEqual({ top: 2, left: 1, right: 1, bottom: 1 });
    expect(zoneSizes(6)).toEqual({ top: 3, left: 1, right: 1, bottom: 1 });
    expect(zoneSizes(7)).toEqual({ top: 2, left: 2, right: 2, bottom: 1 });
    expect(zoneSizes(8)).toEqual({ top: 3, left: 2, right: 2, bottom: 1 });
    expect(zoneSizes(9)).toEqual({ top: 2, left: 3, right: 3, bottom: 1 });
    expect(zoneSizes(10)).toEqual({ top: 3, left: 3, right: 3, bottom: 1 });
  });

  it('顺时针序：左翼（下→上）→ 顶行（左→右）→ 右翼（上→下），下家/上家贴身', () => {
    // 8 人：k1–k2=左翼、k3–k5=顶行、k6–k7=右翼（k7 = 上家，落右翼末位、贴向自己）
    const eight = seatLayout(0, 8);
    expect(eight.slice(1).map((slot) => `${slot.zone}:${slot.col}`)).toEqual([
      'left:0',
      'left:1',
      'top:0',
      'top:1',
      'top:2',
      'right:0',
      'right:1',
    ]);
    expect(eight[1]!.id).toBe('1'); // 下家在左翼 col 0（贴向底行的自己）
    expect(eight[7]!.id).toBe('7'); // 上家在右翼 col 1（贴向底行的自己）
    // 7 人：左右各 2、顶行 2 席
    const seven = seatLayout(0, 7);
    expect(seven.slice(1).map((slot) => `${slot.zone}:${slot.col}`)).toEqual([
      'left:0',
      'left:1',
      'top:0',
      'top:1',
      'right:0',
      'right:1',
    ]);
    // 6 人：左右各 1、顶行 3 席（上家落右翼）
    const six = seatLayout(0, 6);
    expect(six.slice(1).map((slot) => `${slot.zone}:${slot.col}`)).toEqual([
      'left:0',
      'top:0',
      'top:1',
      'top:2',
      'right:0',
    ]);
    // 5 人：左右各 1、顶行 2 席（下家直接落在左翼）
    const five = seatLayout(0, 5);
    expect(five.slice(1).map((slot) => `${slot.zone}:${slot.col}`)).toEqual([
      'left:0',
      'top:0',
      'top:1',
      'right:0',
    ]);
  });

  it('段内 col 与 rowSize 自洽（顶行横排、左右翼纵排、底行恒 1）', () => {
    for (const count of COUNTS) {
      for (const zone of ['top', 'left', 'right', 'bottom'] as const) {
        const inZone = seatLayout(0, count).filter((slot) => slot.zone === zone);
        expect(new Set(inZone.map((slot) => slot.col)).size).toBe(inZone.length);
        for (const slot of inZone) {
          expect(slot.rowSize).toBe(inZone.length);
          expect(slot.col).toBeGreaterThanOrEqual(0);
          expect(slot.col).toBeLessThan(inZone.length);
        }
      }
    }
  });

  it('换视角＝整体循环平移（与规则「自己起顺时针」同向）', () => {
    const base = seatLayout(0, 6).map((slot) => slot.id);
    for (let self = 0; self < 6; self++) {
      expect(seatLayout(self, 6).map((slot) => slot.id)).toEqual([
        ...base.slice(self),
        ...base.slice(0, self),
      ]);
    }
  });

  it('边界：观战按 0 处理、越界取模归一、非法人数返回空数组', () => {
    expect(seatLayout(null, 5)).toEqual(seatLayout(0, 5));
    expect(seatLayout(-1, 5)).toEqual(seatLayout(4, 5));
    expect(seatLayout(7, 5)).toEqual(seatLayout(2, 5));
    expect(seatLayout(0, 0)).toEqual([]);
    expect(seatLayout(0, -3)).toEqual([]);
    expect(seatLayout(0, 4.5)).toEqual([]);
  });

  it('9–10 人：两翼各 3 行吃掉顶行压力，顶行恒 ≤3 张、375 手机也放得下（宽度门控不再拦截）', () => {
    for (const count of [9, 10]) {
      const slots = seatLayout(0, count);
      expect(slots.filter((slot) => slot.zone === 'bottom')).toHaveLength(1);
      expect(slots.filter((slot) => slot.zone === 'left')).toHaveLength(3);
      expect(slots.filter((slot) => slot.zone === 'right')).toHaveLength(3);
      const top = slots.filter((slot) => slot.zone === 'top').length;
      expect(top).toBe(count - 7);
      expect(topRowFits(375, top)).toBe(true);
    }
  });

  it('纯函数：重复调用结果一致', () => {
    expect(seatLayout(3, 9)).toEqual(seatLayout(3, 9));
  });
});

describe('席位视觉映射（seatVisualOf）', () => {
  it('新局：没有标签；本人知道自己的水晶编号、水晶未放出', () => {
    const view = baseView();
    const me = view.players[0]!;
    const visual = seatVisualOf(view, me);
    expect(visual.tokens).toEqual([]);
    expect(visual.seatLabel).toBe('1');
    expect(visual.isSelf).toBe(true);
    expect(visual.handCount).toBe(me.handCount);
    expect(visual.crystal.placed).toBe(false);
    expect(visual.crystal.value).toBe(me.crystal);
    expect(visual.crystal.label).toBe(String(me.crystal));
  });

  it('持币只有一位，且随 coinHolder 变化', () => {
    const view = baseView();
    const coins = view.players.filter((player) => seatVisualOf(view, player).coin);
    expect(coins.map((player) => player.id)).toEqual([view.coinHolder]);
  });

  it('八种状态标签逐一出现，顺序与界面一致（断线 / 托管在最前）', () => {
    const base = baseView();
    const view: GameView = {
      ...base,
      pendingRedraw: 'p1',
      modifiers: {
        ...base.modifiers,
        mustPlay: ['p1'],
        mustPlayRandom: ['p1'],
        mustPass: ['p1'],
        goLastOption: 'p1',
        pairs: [['p1', 'p2']],
      },
      players: base.players.map((player) =>
        player.id === 'p1' ? { ...player, played: true, passed: true } : player,
      ),
    };
    const visual = seatVisualOf(view, view.players[1]!, { offline: true, ai: false });
    expect(visual.tokens.map((token) => token.key)).toEqual([
      'offline',
      'mustPlay',
      'mustPlayRandom',
      'mustPass',
      'mustRedraw',
      'goLast',
      'pair',
      'played',
      'passed',
    ]);
    expect(visual.tokens.map((token) => token.text)).toEqual([
      '断线中',
      '必须出牌',
      '随机出牌',
      '必须跳过',
      '必须换牌',
      '可殿后',
      '行动绑定',
      '已出牌',
      '已跳过',
    ]);
    expect(visual.tokens.filter((token) => token.gray).map((token) => token.key)).toEqual([
      'offline',
      'passed',
    ]);
  });

  it('AI 托管优先于断线，且都在最前', () => {
    const view = baseView();
    expect(seatVisualOf(view, view.players[1]!, { offline: true, ai: true }).tokens).toEqual([
      { key: 'ai', text: 'AI 托管', gray: true },
    ]);
  });

  it('缺省 presence（热座 / 无服务器状态）不产生断线或托管标签', () => {
    const view = baseView();
    expect(seatVisualOf(view, view.players[1]!).tokens).toEqual([]);
    expect(seatVisualOf(view, view.players[1]!, { offline: false, ai: false }).tokens).toEqual([]);
  });

  it('「可殿后」在用掉之后不再显示', () => {
    const base = baseView();
    const view: GameView = {
      ...base,
      modifiers: { ...base.modifiers, goLastOption: 'p1', goLastUsed: true },
    };
    expect(seatVisualOf(view, view.players[1]!).tokens).toEqual([]);
  });

  it('「必须换牌」只在指向该玩家时出现', () => {
    const base = baseView();
    const view: GameView = { ...base, pendingRedraw: 'p1' };
    expect(seatVisualOf(view, view.players[0]!).tokens).toEqual([]);
    expect(seatVisualOf(view, view.players[1]!).tokens.map((token) => token.key)).toEqual([
      'mustRedraw',
    ]);
  });

  it('别人的水晶只有放上版图后才知道编号', () => {
    const base = baseView();
    const other = base.players[1]!;
    expect(seatVisualOf(base, other).isSelf).toBe(false);
    expect(seatVisualOf(base, other).crystal).toEqual({ value: null, placed: false, label: '' });

    const placed: GameView = {
      ...base,
      crystalTrack: [...base.crystalTrack, { player: other.id, value: 7 }],
      players: base.players.map((player) =>
        player.id === other.id ? { ...player, crystalPlaced: true } : player,
      ),
    };
    expect(seatVisualOf(placed, placed.players[1]!).crystal).toEqual({
      value: 7,
      placed: true,
      label: '7',
    });
  });

  it('同一视图里看别人：不下发角色 / 手牌，故席位信息只含公开项', () => {
    const view = baseView();
    const other = view.players[1]!;
    expect(other.role).toBeUndefined();
    expect(other.hand).toBeUndefined();
    expect(seatVisualOf(view, other).crystal.label).toBe('');
  });

  it('5–10 人局 × 每个视角穷举：每位玩家都能算出完整席位信息', () => {
    for (const count of COUNTS) {
      const state = createGame(
        Array.from({ length: count }, (_, i) => `P${i + 1}`),
        { seed: 11 },
      );
      for (let viewer = 0; viewer < count; viewer++) {
        const view = playerView(state, `p${viewer}`);
        expect(view.players).toHaveLength(count);
        for (const player of view.players) {
          const visual = seatVisualOf(view, player, { offline: false, ai: false });
          expect(visual.seatLabel).toBe(String(player.seat + 1));
          expect(visual.isSelf).toBe(player.id === `p${viewer}`);
          expect(visual.tokens).toEqual([]);
          expect(visual.handCount).toBe(player.handCount);
        }
      }
    }
  });

  it('纯函数：不改动传入的视图', () => {
    const view = deepFreeze(baseView());
    const before = JSON.parse(JSON.stringify(view));
    seatVisualOf(view, view.players[0]!, { offline: true, ai: false });
    expect(JSON.parse(JSON.stringify(view))).toEqual(before);
  });
});

describe('卡面语义（cardFaceOf）', () => {
  it('幽魂与信者：各自的画心与色调', () => {
    expect(cardFaceOf({ id: 'g1', kind: 'ghost' })).toEqual({
      kind: 'ghost',
      label: '幽魂',
      tone: 'neutral',
    });
    expect(cardFaceOf({ id: 'b1', kind: 'believer' })).toEqual({
      kind: 'believer',
      label: '信者',
      tone: 'whiteRose',
    });
  });

  it('六个角色牌：画心＝角色名，色调＝所属阵营', () => {
    for (const role of ROLE_ORDER) {
      const card: Card = { id: role, kind: 'role', role: role as Role };
      expect(cardFaceOf(card)).toEqual({
        kind: role,
        label: ROLE_LABEL[role],
        tone: FACTION_OF[role],
      });
    }
  });

  it('与 cards.tsx 的 cardLabel 保持一致（那边已委托本函数）', () => {
    const cards: Card[] = [
      { id: 'g1', kind: 'ghost' },
      { id: 'b1', kind: 'believer' },
      ...ROLE_ORDER.map((role) => ({ id: role, kind: 'role' as const, role: role as Role })),
    ];
    for (const card of cards) {
      expect(cardFaceOf(card).label).toBe(cardLabel(card));
    }
  });
});

describe('顶行宽度门控（topRowFits）——9–10 人局环绕溢出回归', () => {
  it('5–10 人局的顶行（seatLayout 恒 ≤3 张）：375 手机与 320 极窄屏都放得下', () => {
    for (const count of COUNTS) {
      const top = seatLayout(0, count).filter((slot) => slot.zone === 'top').length;
      expect(topRowFits(375, top)).toBe(true);
      expect(topRowFits(320, top)).toBe(true);
    }
  });

  it('顶行 3 张以内：任何常见视口都放得下', () => {
    for (const width of [320, 375, 414, 560, 561, 768, 1280]) {
      for (let top = 0; top <= 3; top++) {
        expect(topRowFits(width, top)).toBe(true);
      }
    }
  });

  it('顶行 4 张（旧 9 人局形态，历史回归）：375 手机放不下（最右出屏），桌面放得下', () => {
    expect(topRowFits(375, 4)).toBe(false);
    expect(topRowFits(320, 4)).toBe(false);
    expect(topRowFits(560, 4)).toBe(false);
    expect(topRowFits(600, 4)).toBe(true);
    expect(topRowFits(768, 4)).toBe(true);
  });

  it('顶行 5 张（旧 10 人局形态，历史回归）：手机与窄窗口放不下，宽视口放得下', () => {
    expect(topRowFits(375, 5)).toBe(false);
    expect(topRowFits(560, 5)).toBe(false);
    expect(topRowFits(600, 5)).toBe(false);
    expect(topRowFits(768, 5)).toBe(true);
    expect(topRowFits(1280, 5)).toBe(true);
  });

  it('非法入参：空顶行恒可放，其余返回 false', () => {
    expect(topRowFits(375, 0)).toBe(true);
    expect(topRowFits(0, 3)).toBe(false);
    expect(topRowFits(-1, 3)).toBe(false);
    expect(topRowFits(Number.NaN, 3)).toBe(false);
    expect(topRowFits(375, 1.5)).toBe(false);
    expect(topRowFits(375, -1)).toBe(false);
  });
});
