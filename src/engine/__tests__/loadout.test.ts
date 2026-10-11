import { describe, expect, it } from 'vitest';
import {
  CRYSTAL_NUMBERS,
  LOADOUT_2025,
  LOADOUT_BASE,
  createGame,
  loadoutEntries,
  resolveLoadout,
  sameLoadout,
  skillOfCrystal,
  validateLoadout,
  type GameState,
  type Role,
} from '../index';

const NAMES = ['A', 'B', 'C', 'D', 'E'];
const ROLES_5: Record<number, Role> = {
  0: 'whiteRose',
  1: 'bishop',
  2: 'believer',
  3: 'doubleBlade',
  4: 'darkBlade',
};

describe('技能组（loadout）数据模型', () => {
  it('初版与 2025 预设都是合法的 12 槽技能组', () => {
    expect(validateLoadout(LOADOUT_BASE)).toBeNull();
    expect(validateLoadout(LOADOUT_2025)).toBeNull();
    expect(LOADOUT_BASE[1]).toBe('forcePlay');
    expect(LOADOUT_BASE[12]).toBe(LOADOUT_BASE[1]); // 初版 1≡12
    expect(LOADOUT_2025[11]).toBe(LOADOUT_2025[2]); // 扩充 11≡2
    expect(LOADOUT_2025[12]).toBe(LOADOUT_2025[1]); // 扩充 12≡1
  });

  it('非法技能组一律被拒：缺槽、多槽、非数字键、未知技能、原型链键', () => {
    const missing: Record<number, unknown> = { ...LOADOUT_BASE };
    delete missing[5];
    expect(validateLoadout(missing)).not.toBeNull();

    expect(validateLoadout({ ...LOADOUT_BASE, 13: 'forcePlay' })).not.toBeNull();
    expect(validateLoadout({ ...LOADOUT_BASE, x: 'forcePlay' })).not.toBeNull();
    expect(validateLoadout({ ...LOADOUT_BASE, 3: 'constructor' })).not.toBeNull();
    expect(validateLoadout({ ...LOADOUT_BASE, 3: 'notASkill' })).not.toBeNull();
    expect(validateLoadout(null)).not.toBeNull();
    expect(validateLoadout([1, 2, 3])).not.toBeNull();

    // JSON.parse 的 __proto__ 是自有属性：必须被当成非法槽位拒绝
    const json = `{${Object.entries(LOADOUT_BASE)
      .map(([k, v]) => `"${k}":"${v}"`)
      .join(',')},"__proto__":"forcePlay"}`;
    expect(validateLoadout(JSON.parse(json))).not.toBeNull();
  });

  it('原型链上的伪槽位被忽略：解析结果只含 1-12 个自有槽', () => {
    const sneaky = Object.assign(Object.create({ 13: 'forcePlay' }), LOADOUT_BASE);
    expect(validateLoadout(sneaky)).toBeNull();
    const out = resolveLoadout(sneaky);
    expect(Object.keys(out).sort()).toEqual(CRYSTAL_NUMBERS.map(String).sort());
  });

  it('resolveLoadout：缺省/非法回退初版；合法原样采纳且不共享引用', () => {
    expect(sameLoadout(resolveLoadout(undefined), LOADOUT_BASE)).toBe(true);
    expect(sameLoadout(resolveLoadout({ 1: 'forcePlay' }), LOADOUT_BASE)).toBe(true);

    const out = resolveLoadout(LOADOUT_2025);
    expect(out).not.toBe(LOADOUT_2025);
    expect(sameLoadout(out, LOADOUT_2025)).toBe(true);
    out[3] = 'forcePlay';
    expect(LOADOUT_2025[3]).toBe('randomPlay'); // 预设常量不被污染
  });

  it('skillOfCrystal 按技能组查询', () => {
    expect(skillOfCrystal(3, LOADOUT_BASE)).toBe('rightNeighborRandom');
    expect(skillOfCrystal(3, LOADOUT_2025)).toBe('randomPlay');
    expect(skillOfCrystal(1, LOADOUT_2025)).toBe('forcePlay');
  });

  it('loadoutEntries 按槽序展开技能名（大厅 / 房间面板展示用）', () => {
    const base = loadoutEntries(LOADOUT_BASE);
    expect(base.map((entry) => entry.slot)).toEqual(CRYSTAL_NUMBERS);
    expect(base[0].name).toBe('强制出牌');
    expect(base[0].text).not.toBe('');
    expect(loadoutEntries(LOADOUT_2025)[2].name).toBe('随机出牌');
    // 指针非法时兜底为「未装配」，不抛异常
    expect(loadoutEntries({ 1: 'forcePlay' } as typeof LOADOUT_BASE)[1].name).toBe('未装配');
  });
});

describe('技能组随对局固化（G.skills）', () => {
  it('createGame 把技能组写进状态，且可序列化往返', () => {
    const s: GameState = createGame(NAMES, { seed: 1, roles: ROLES_5, loadout: LOADOUT_2025 });
    expect(sameLoadout(s.skills, LOADOUT_2025)).toBe(true);
    const roundTrip = JSON.parse(JSON.stringify(s.skills)) as typeof s.skills;
    expect(sameLoadout(roundTrip, LOADOUT_2025)).toBe(true);
  });

  it('非法技能组回退初版（兼容旧房间/旧客户端）', () => {
    const s = createGame(NAMES, { seed: 1, roles: ROLES_5, loadout: { 1: 'forcePlay' } });
    expect(sameLoadout(s.skills, LOADOUT_BASE)).toBe(true);
  });

  it('初版 loadout 下扩充字段全部为默认值（行为零变化的结构保证）', () => {
    const s = createGame(NAMES, { seed: 1, roles: ROLES_5 });
    expect(sameLoadout(s.skills, LOADOUT_BASE)).toBe(true);
    expect(s.lap).toBe(1);
    expect(s.modifiers.randomPlay).toBe(false);
    expect(s.modifiers.laps).toBe(1);
    expect(s.modifiers.trio).toBeNull();
    expect(s.modifiers.revealAtCount).toBeNull();
    expect(s.modifiers.bishopMustPlay).toBe(false);
    expect(s.modifiers.noGhost).toBe(false);
    expect(s.modifiers.pendingPick).toBeNull();
  });
});