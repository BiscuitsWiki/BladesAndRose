import { Client } from 'boardgame.io/client';
import { Local } from 'boardgame.io/multiplayer';
import type { Game } from 'boardgame.io';
import { describe, expect, it } from 'vitest';
import {
  CRYSTAL_NUMBERS,
  LOADOUT_2025,
  LOADOUT_BASE,
  createGame,
  type GameState,
  type GameView,
  type SkillLoadout,
} from '../../engine';
import { createBladesAndRose } from '../game';

/**
 * 回归扫描（历史症状）：
 * 水晶技能发动「前 / 后」，当前玩家有时会丢失操作面板——手牌与版图消失、无法出牌 / 跳过。
 * 已知根因是 hotseat 下 Local 传输器的广播缺陷（切视角必须**重建 client**，不能 updatePlayerID），
 * App 已按此实现；本文件用真实 boardgame.io Local 管线，把**每个水晶技能**（两套技能组、共 12 槽）
 * 的发动流程逐步走一遍，并在每一步断言：
 *   1. 当前视角本人的 `role` 与 `hand` 都在视图里（= 「你的手牌」面板的渲染前提，`me?.role`）；
 *   2. 当前行动者存在、五个座位都在视图里；
 *   3. 发动者之后仍能正常出牌 / 跳过，整轮能推进完成（无死锁、无丢视角）。
 */

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

type C = ReturnType<typeof makeClient>;

const viewOf = (client: C): GameView =>
  (client.getState() as unknown as { G: GameView } | null)!.G;

/** 与 App 的热座路径一致：切换视角 = 重建 client（同 game 对象 + 同 matchID 会复用同一局） */
function makeClient(game: Game<GameState>, matchID: string, seat: string) {
  return Client({
    game,
    numPlayers: 5,
    multiplayer: Local(),
    playerID: seat,
    matchID,
  });
}

/** 造一个固定水晶 / 固定持币座位的测试对局（走与 App 相同的 setup，只是水晶可控） */
function gameWith(loadout: SkillLoadout, crystals: Record<number, number>): Game<GameState> {
  const base = createBladesAndRose(null, loadout);
  const setup = (context: { ctx: { numPlayers: number } }) => {
    const count = context.ctx.numPlayers;
    const names = Array.from({ length: count }, (_, i) => `玩家 ${i + 1}`);
    return createGame(names, {
      seed: 42,
      playerIds: Array.from({ length: count }, (_, i) => String(i)),
      crystals,
      coinSeat: 0,
      loadout,
    });
  };
  return { ...base, setup } as unknown as Game<GameState>;
}

/** 按「当前视角能看到的公开信息」决定一个合法动作（与真人操作同一信息面） */
function actByView(client: C, view: GameView, seat: string): void {
  switch (view.phase) {
    case 'magic': {
      const target = view.players.find((p) => !p.crystalPlaced);
      expect(target, '传币阶段应有可接收硬币的玩家').toBeDefined();
      client.moves.passCoin(target!.id);
      return;
    }
    case 'magicTargets': {
      const pending = view.pendingMagic!;
      // 目标池与必选数都由引擎下发（客户端不自行推断）
      client.moves.resolveMagicTargets(pending.pool.slice(0, pending.needTargets));
      return;
    }
    case 'play': {
      const self = view.players.find((p) => p.id === seat)!;
      const bishopForced =
        view.modifiers.bishopMustPlay && self.role === 'bishop' && (self.hand?.length ?? 0) > 0;
      if (view.pendingRedraw === seat || view.modifiers.mustPlay.includes(seat) || bishopForced) {
        client.moves.playCard(self.hand![0]!.id);
      } else {
        client.moves.passTurn();
      }
      return;
    }
    case 'prePick': {
      const pool = view.modifiers.pendingPick!.pool;
      expect(pool.length, '进入公开前补出决策时目标池不应为空').toBeGreaterThan(0);
      client.moves.pickPreShuffleTarget(pool[0]!);
      return;
    }
    case 'redraw': {
      client.moves.resolveRedraw();
      return;
    }
    default:
      throw new Error(`无法推进的阶段：${view.phase}`);
  }
}

/**
 * 走完一个技能从发动到本轮结束的全过程：
 * 阶段一先把硬币交给水晶持有者（= 技能发动者），随后逐步跟随 currentActor 切换视角并操作。
 */
async function sweepSkill(loadout: SkillLoadout, tag: string, crystal: number, cross: boolean) {
  const caster = cross ? '1' : '0';
  const game = gameWith(loadout, { [Number(caster)]: crystal });
  const matchID = `skill-${tag}-${crystal}-${cross ? 'cross' : 'self'}`;

  // ---- 发动：持币者（座位 0）把硬币交给水晶持有者，技能随之结算或挂起待选目标 ----
  let client = makeClient(game, matchID, '0');
  client.start();
  await tick();
  expect(viewOf(client), '持币者视角应拿到状态').toBeDefined();
  client.moves.passCoin(caster);
  await tick();
  client.stop();

  // ---- 发动后：切到发动者座位，其后必须仍持有「你的手牌」面板数据并能操作 ----
  let seat = caster;
  client = makeClient(game, matchID, seat);
  client.start();
  await tick();

  const casterRow = () => viewOf(client).players.find((p) => p.id === caster);
  expect(casterRow()?.role, '发动者本人在视图里应带角色（否则手牌面板消失）').toBeDefined();
  expect(casterRow()?.hand, '发动者本人在视图里应带手牌').toBeDefined();

  let guard = 0;
  while (viewOf(client).phase !== 'finished' && viewOf(client).round === 1) {
    expect(guard++, '本轮应在有限步内完成（防止丢视角导致的死锁）').toBeLessThan(40);
    const view = viewOf(client);
    expect(view.players, '视图应包含全部 5 个座位').toHaveLength(5);

    const actor = view.currentActor;
    expect(actor, '等待决策时必须有当前行动者').not.toBeNull();
    if (actor !== seat) {
      // 切换视角 = 重建 client（App 的做法；用 updatePlayerID 会踩 Local 广播缺陷）
      client.stop();
      seat = actor!;
      client = makeClient(game, matchID, seat);
      client.start();
      await tick();
    }

    const current = viewOf(client);
    const self = current.players.find((p) => p.id === seat)!;
    expect(self.role, `座位 ${seat} 正在行动，其视角必须有角色（操作面板前提）`).toBeDefined();
    expect(self.hand, `座位 ${seat} 正在行动，其视角必须有手牌`).toBeDefined();

    actByView(client, current, seat);
    await tick();
    expect(viewOf(client), '动作之后视角仍应拿到状态').toBeDefined();
  }
  client.stop();
}

describe('技能释放前后：操作面板不丢失（全技能扫描）', () => {
  const loadouts: { id: string; loadout: SkillLoadout }[] = [
    { id: 'base', loadout: LOADOUT_BASE },
    { id: '2025', loadout: LOADOUT_2025 },
  ];

  for (const spec of loadouts) {
    for (const crystal of CRYSTAL_NUMBERS) {
      for (const cross of [false, true] as const) {
        it(`${spec.id} · 水晶 ${crystal} · ${cross ? '传给座位 2 发动' : '自己发动'}`, async () => {
          await sweepSkill(spec.loadout, spec.id, crystal, cross);
        });
      }
    }
  }

  /**
   * 用户此前报过的具体症状：水晶 5「行动绑定」发动后，发动者的手牌 / 版图丢失、无法出牌 / 跳过。
   * 这里把该场景单独点名验证（含发动者本人后续出牌）。
   */
  it('回归点名：水晶 5「行动绑定」发动后，发动者仍可出牌 / 跳过', async () => {
    const game = gameWith(LOADOUT_BASE, { 1: 5 }); // 座位 2（id=1）持有 5 号
    const matchID = 'pair-action-regression';

    let client = makeClient(game, matchID, '0');
    client.start();
    await tick();
    client.moves.passCoin('1'); // 座位 1 把硬币交给座位 2 → 发动「行动绑定」
    await tick();
    client.stop();

    // 切到发动者视角（重建 client），此刻仍处于「选择魔法目标」
    client = makeClient(game, matchID, '1');
    client.start();
    await tick();
    let view = viewOf(client);
    expect(view.phase).toBe('magicTargets');
    expect(view.pendingMagic?.skill).toBe('pairAction');
    expect(view.players.find((p) => p.id === '1')?.role, '发动者视角必须有角色').toBeDefined();
    expect(view.players.find((p) => p.id === '1')?.hand, '发动者视角必须有手牌').toBeDefined();

    // 选两名目标 → 技能结算
    client.moves.resolveMagicTargets(view.pendingMagic!.pool.slice(0, view.pendingMagic!.needTargets));
    await tick();
    view = viewOf(client);
    expect(view.phase).toBe('play');
    expect(view.modifiers.pairs.length).toBe(1);
    expect(view.players.find((p) => p.id === '1')?.role, '结算后发动者视角必须仍有角色').toBeDefined();

    // 发动者（座位 2）出牌：手牌仍可点、动作被接受
    const hand = view.players.find((p) => p.id === '1')!.hand!;
    const stateID = (client.getState() as unknown as { _stateID: number })._stateID;
    client.moves.playCard(hand[0]!.id);
    await tick();
    const after = client.getState() as unknown as { _stateID: number; G: GameView };
    expect(after._stateID).toBe(stateID + 1);
    expect(after.G.players.find((p) => p.id === '1')?.role, '出牌后发动者视角仍须保留').toBeDefined();
    client.stop();
  });
});