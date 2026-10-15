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
import { cardFaceOf, seatLayout, seatVisualOf } from '../scene';

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

describe('席位环布局（seatLayout）', () => {
  it('5–10 人 × 每个视角：长度正确、座位号唯一、自己恒在底部居中', () => {
    for (const count of COUNTS) {
      for (let self = 0; self < count; self++) {
        const slots = seatLayout(self, count);
        expect(slots).toHaveLength(count);
        expect(new Set(slots.map((slot) => slot.id)).size).toBe(count);
        expect(slots[0]).toEqual({ id: String(self), x: 0.5, y: 1, angle: 0 });
      }
    }
  });

  it('自己在下、下家在左下、对面在正上方（偶数局）', () => {
    const five = seatLayout(0, 5);
    expect(five[1]!.x).toBeLessThan(0.5);
    expect(five[1]!.y).toBeGreaterThan(0.5);
    // 顺时针为正：下家的朝向角为正、对面为 180
    expect(five[1]!.angle).toBeGreaterThan(0);
    expect(five[4]!.x).toBeGreaterThan(0.5);

    const six = seatLayout(0, 6);
    expect(six[3]!.x).toBeCloseTo(0.5, 6);
    expect(six[3]!.y).toBeCloseTo(0, 6);
    expect(six[3]!.angle).toBeCloseTo(180, 6);
  });

  it('所有点都落在 0–1 内、且位于半径 0.5 的圆上（椭圆化交给各端容器）', () => {
    for (const count of COUNTS) {
      for (const slot of seatLayout(0, count)) {
        expect(slot.x).toBeGreaterThanOrEqual(0);
        expect(slot.x).toBeLessThanOrEqual(1);
        expect(slot.y).toBeGreaterThanOrEqual(0);
        expect(slot.y).toBeLessThanOrEqual(1);
        expect((slot.x - 0.5) ** 2 + (slot.y - 0.5) ** 2).toBeCloseTo(0.25, 5);
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
