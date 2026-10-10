import { Client } from 'boardgame.io/client';
import { Local } from 'boardgame.io/multiplayer';
import { describe, expect, it } from 'vitest';
import { BladesAndRose, getBladesAndRose } from '../game';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 无头复现：用真实的 boardgame.io client + Local 传输器走一遍，
 * 用来定位「进入对局后无法行动」的问题。
 */
describe('boardgame.io 客户端冒烟', () => {
  it('能建立连接、拿到过滤后的状态并提交动作', async () => {
    const client = Client({
      game: BladesAndRose,
      numPlayers: 5,
      multiplayer: Local(),
      playerID: '0',
      matchID: 'smoke-1',
    });
    client.start();
    await tick();

    const state = client.getState() as unknown as {
      G: { phase: string; coinHolder: string; crystalsPlaced: number; players: { id: string }[] };
      ctx: { currentPlayer: string; activePlayers: unknown };
      playerID: string | null;
    } | null;

    console.log('[冒烟] getState() ===', state === null ? 'null' : '有状态');
    if (!state) {
      // 状态为 null 说明客户端根本没收到状态，界面只会渲染 loading
      expect(state).not.toBeNull();
      return;
    }

    console.log('[冒烟] client.playerID =', client.playerID);
    console.log('[冒烟] ctx.currentPlayer =', state.ctx.currentPlayer);
    console.log('[冒烟] ctx.activePlayers =', JSON.stringify(state.ctx.activePlayers));
    console.log('[冒烟] G.phase =', state.G.phase, ' coinHolder =', state.G.coinHolder);
    console.log('[冒烟] G 是否已被 playerView 过滤 =', 'thresholds' in state.G);

    // 切到持币者座位再提交动作
    client.updatePlayerID(state.G.coinHolder);
    await tick();

    const before = (client.getState() as unknown as { G: { crystalsPlaced: number } }).G.crystalsPlaced;
    client.moves.passCoin(state.G.coinHolder);
    await tick();

    const after = (client.getState() as unknown as { G: { crystalsPlaced: number } }).G.crystalsPlaced;
    console.log('[冒烟] crystalsPlaced 提交前/后 =', before, '/', after);

    expect(after).toBe(before + 1);

    // 回归：非当前行动者的动作应被引擎拒绝，且状态不变
    const notActor = Object.keys(state.ctx.activePlayers ?? {}).find(
      (id) => id !== (client.getState() as unknown as { G: { currentActor: string } }).G.currentActor,
    )!;
    client.updatePlayerID(notActor);
    await tick();
    const snapshot = (client.getState() as unknown as { G: { crystalsPlaced: number } }).G.crystalsPlaced;
    client.moves.passCoin(notActor);
    await tick();
    console.log('[冒烟] 非行动者提交后 crystalsPlaced =', snapshot);
    expect((client.getState() as unknown as { G: { crystalsPlaced: number } }).G.crystalsPlaced).toBe(snapshot);
  });

  it('热座切换视角：重建 client 后状态推进仍保有自己的视图（Local 广播缺陷的用法回归）', async () => {
    // 用一份独立配比拿独立的 game 对象（Local() 按 game 对象缓存 master，避免与上一条用例共用对局）
    const game = getBladesAndRose({
      whiteRose: 1,
      bishop: 1,
      believer: 1,
      doubleBlade: 1,
      greatBlade: 0,
      darkBlade: 1,
    });

    const makeClient = (seat: string) =>
      Client({
        game,
        numPlayers: 5,
        multiplayer: Local(),
        playerID: seat,
        matchID: 'smoke-seat-switch',
      });
    type C = ReturnType<typeof makeClient>;

    /** 当前 client 的视图里，指定座位那一行是否带角色（「你的手牌」面板渲染的前提） */
    const roleInView = (c: C, seat: string) => {
      const s = c.getState() as unknown as { G: { players: { id: string; role?: string }[] } } | null;
      return s?.G.players.find((p) => p.id === seat)?.role;
    };

    // 开局持币者随机：先探测，再以持币者身份把硬币交给座位 0（受币者成为本阶段行动者）
    const probe = makeClient('0');
    probe.start();
    await tick();
    const holder = (probe.getState() as unknown as { G: { coinHolder: string } }).G.coinHolder;
    probe.stop();

    let client = makeClient(holder);
    client.start();
    await tick();
    client.moves.passCoin('0');
    await tick();

    // 受币者是座位 0：需要指定目标时由其选一个合法目标，进入出牌阶段
    client.stop();
    client = makeClient('0');
    client.start();
    await tick();
    let phase = (client.getState() as unknown as { G: { phase: string } }).G.phase;
    if (phase === 'magicTargets') {
      for (const targets of [['1'], ['2'], ['3'], ['4'], ['1', '2'], ['1', '3'], ['2', '3'], ['0', '1']]) {
        client.moves.resolveMagicTargets(targets);
        await tick();
        phase = (client.getState() as unknown as { G: { phase: string } }).G.phase;
        if (phase !== 'magicTargets') break;
      }
    }
    expect(phase).toBe('play');

    // 访问座位 1 再回到座位 0（App 的做法：切换视角 = 重建 client，而不是 updatePlayerID）
    client.stop();
    client = makeClient('1');
    client.start();
    await tick();
    expect(roleInView(client, '1')).toBeDefined();

    client.stop();
    client = makeClient('0');
    client.start();
    await tick();
    expect(roleInView(client, '0')).toBeDefined();

    // 状态推进（master 会向所有注册过的座位广播同一状态）：仍应拿到自己的视图。
    // 若改回 client.updatePlayerID 切换视角，这一步会拿到别的座位的过滤视图、「你的手牌」随之消失。
    const before = (client.getState() as unknown as { _stateID: number })._stateID;
    client.moves.passTurn();
    await tick();
    expect((client.getState() as unknown as { _stateID: number })._stateID).toBe(before + 1);
    expect(roleInView(client, '0')).toBeDefined();
  });

  it('自定义配比会产出独立的 game 对象，并能正常开局', async () => {
    const custom = {
      whiteRose: 1,
      bishop: 0,
      believer: 2,
      doubleBlade: 0,
      greatBlade: 1,
      darkBlade: 1,
    };
    const game = getBladesAndRose(custom);

    // boardgame.io 的 Local() 把 game 对象「引用」当 master 缓存键：
    // 相同配比必须复用同一对象，才能继续原局；不同配比必须是新对象，才不会读到旧配比的状态。
    expect(getBladesAndRose({ ...custom })).toBe(game);
    expect(getBladesAndRose(null)).not.toBe(game);
    expect(getBladesAndRose(null)).toBe(BladesAndRose);

    const client = Client({
      game,
      numPlayers: 5,
      multiplayer: Local(),
      playerID: '0',
      matchID: 'smoke-custom',
    });
    client.start();
    await tick();

    const state = client.getState() as unknown as { G: { phase: string } } | null;
    expect(state).not.toBeNull();
    expect(state!.G.phase).toBe('magic');
  });
});
