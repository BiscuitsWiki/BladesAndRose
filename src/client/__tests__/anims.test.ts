import { describe, expect, it } from 'vitest';
import {
  COIN_FLIGHT_MS,
  CRYSTAL_PULSE_MS,
  TURN_PULSE_MS,
  planAnims,
  type AnimSnapshot,
} from '../anims';

/** 造一帧快照；参数只覆盖关心的字段 */
function snap(over: Partial<AnimSnapshot> = {}): AnimSnapshot {
  return {
    coinHolder: '0',
    crystalsPlaced: 0,
    lastCrystalBy: null,
    currentActor: '0',
    ...over,
  };
}

describe('动效编排（planAnims）', () => {
  it('首次挂载（prev 为 null）一律不播：刷新 / 切视角重建 client 时画面本就从头渲染', () => {
    const plan = planAnims(null, snap({ crystalsPlaced: 3, lastCrystalBy: '2' }), false);
    expect(plan).toEqual({ coin: null, crystal: null, turn: null });
  });

  it('prefers-reduced-motion 生效时一律不播', () => {
    const prev = snap();
    const next = snap({ coinHolder: '3', crystalsPlaced: 1, lastCrystalBy: '0', currentActor: '3' });
    expect(planAnims(prev, next, true)).toEqual({ coin: null, crystal: null, turn: null });
  });

  it('持币者变更 → 硬币从原持币者飞给新持币者', () => {
    const plan = planAnims(snap({ coinHolder: '1' }), snap({ coinHolder: '4' }), false);
    expect(plan.coin).toEqual({ from: '1', to: '4' });
  });

  it('持币者未变 → 不播硬币动画', () => {
    expect(planAnims(snap({ coinHolder: '2' }), snap({ coinHolder: '2' }), false).coin).toBeNull();
  });

  it('水晶数增加 → 播刚发动那枚水晶的座位（取 crystalTrack 末条）', () => {
    const plan = planAnims(
      snap({ crystalsPlaced: 1, lastCrystalBy: '0' }),
      snap({ crystalsPlaced: 2, lastCrystalBy: '3' }),
      false,
    );
    expect(plan.crystal).toBe('3');
  });

  it('水晶数未增加（含新一轮复位减少）→ 不播水晶动画', () => {
    expect(
      planAnims(
        snap({ crystalsPlaced: 2, lastCrystalBy: '3' }),
        snap({ crystalsPlaced: 2, lastCrystalBy: '3' }),
        false,
      ).crystal,
    ).toBeNull();
    // 重开一局：水晶归零，不应逆序播动画
    expect(
      planAnims(
        snap({ crystalsPlaced: 3, lastCrystalBy: '2' }),
        snap({ crystalsPlaced: 0, lastCrystalBy: null }),
        false,
      ).crystal,
    ).toBeNull();
  });

  it('水晶数增加了但末条缺失 → 不播（拿不到座位就不猜）', () => {
    expect(
      planAnims(snap({ crystalsPlaced: 0 }), snap({ crystalsPlaced: 1, lastCrystalBy: null }), false)
        .crystal,
    ).toBeNull();
  });

  it('行动者变更 → 脉冲提醒新行动者；未变或为 null → 不播', () => {
    expect(planAnims(snap({ currentActor: '0' }), snap({ currentActor: '2' }), false).turn).toBe('2');
    expect(planAnims(snap({ currentActor: '2' }), snap({ currentActor: '2' }), false).turn).toBeNull();
    // 阶段交替时 currentActor 可能变 null：不脉冲
    expect(planAnims(snap({ currentActor: '2' }), snap({ currentActor: null }), false).turn).toBeNull();
    // 从 null 变成具体座位：应当脉冲
    expect(planAnims(snap({ currentActor: null }), snap({ currentActor: '1' }), false).turn).toBe('1');
  });

  it('三种动效可以同时触发（一次动作里既传币又发动水晶）', () => {
    const plan = planAnims(
      snap({ coinHolder: '0', crystalsPlaced: 0, currentActor: '0' }),
      snap({ coinHolder: '1', crystalsPlaced: 1, lastCrystalBy: '1', currentActor: '1' }),
      false,
    );
    expect(plan.coin).toEqual({ from: '0', to: '1' });
    expect(plan.crystal).toBe('1');
    expect(plan.turn).toBe('1');
  });

  it('纯函数：不改动传入的快照', () => {
    const prev = snap({ coinHolder: '0' });
    const next = snap({ coinHolder: '1' });
    const before = JSON.stringify([prev, next]);
    planAnims(prev, next, false);
    expect(JSON.stringify([prev, next])).toBe(before);
  });

  it('时长常量与文档一致（传币 500 / 水晶 800 / 回合提醒 900 毫秒）', () => {
    expect([COIN_FLIGHT_MS, CRYSTAL_PULSE_MS, TURN_PULSE_MS]).toEqual([500, 800, 900]);
  });
});
