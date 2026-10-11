import type { ActivePlayersArg, Game, PlayerID } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import {
  ROLE_ORDER,
  applyMoveInPlace,
  createGame,
  loadoutSignature,
  playerView as enginePlayerView,
  type Distribution,
  type GameState,
  type GameView,
  type Move as EngineMove,
  type SkillLoadout,
} from '../engine';

/** 观众（未取座）使用一个不会匹配任何玩家的 id，playerView 因此只返回公开信息 */
const SPECTATOR = '__spectator__';

function toPlayerId(playerID: PlayerID | null): string {
  return playerID ?? SPECTATOR;
}

/**
 * boardgame.io 的 move 收到的是 immer draft，必须就地修改。
 * 引擎的 applyMoveInPlace 不做克隆，正好适配；若内部抛错，immer 会自动回滚整次修改。
 */
function run(G: GameState, move: EngineMove): void | typeof INVALID_MOVE {
  try {
    applyMoveInPlace(G, move);
  } catch (error) {
    console.warn('[blades-and-rose] 非法动作已拒绝：', (error as Error).message);
    return INVALID_MOVE;
  }
  return undefined;
}

/**
 * 用给定配比构造一个 boardgame.io game 对象。
 * override 为 null 表示完全使用官方配比（按实际人数取值）。
 * loadout 为热座技能组（联机时由服务器经 setupData 带入，优先级更高）。
 */
export function createBladesAndRose(
  override: Partial<Distribution> | null,
  loadout: SkillLoadout | null = null,
): Game<GameState> {
  return {
    name: gameNameOf(override),
    minPlayers: 5,
    maxPlayers: 10,
    // 隐藏身份游戏不允许悔棋
    disableUndo: true,

    /**
     * 本游戏的行动顺序完全由引擎的 G.currentActor 自己管理，
     * boardgame.io 的 turn/phases 不参与调度。
     *
     * 但 master 在放行动作前会调用 flow.isPlayerActive(G, ctx, playerID) 校验，
     * 没有 activePlayers 时该判断等价于 playerID === ctx.currentPlayer，
     * 而 ctx.currentPlayer 默认恒为 '0' 且我们从不推进 turn —— 结果就是
     * 除座位 0 以外所有人的动作都会被 master 拦掉（player not active）。
     * 因此这里声明全体玩家始终处于 active 状态，把调度权完全交给引擎。
     */
    turn: {
      // 运行时必须写 all: true 才会把全体玩家登记为 active；
      // 但 boardgame.io 的类型声明 StageArg 不接受 true（声明与实现不一致），故此处显式收窄。
      activePlayers: { all: true } as unknown as ActivePlayersArg,
    },

    setup: ({ ctx }, setupData) => {
      const count = ctx.numPlayers;
      const names = Array.from({ length: count }, (_, i) => `玩家 ${i + 1}`);
      // 联机：服务器把房内技能组经 setupData 带入（唯一权威）；热座：本地构造时直接指定
      const setupLoadout = (setupData as { loadout?: SkillLoadout } | undefined)?.loadout;
      return createGame(names, {
        // 引擎玩家 id 与 boardgame.io 的 playerID 完全一致，省掉一层映射
        playerIds: Array.from({ length: count }, (_, i) => String(i)),
        distribution: override,
        loadout: setupLoadout ?? loadout ?? undefined,
      });
    },

    moves: {
      // noLimit: true —— 关闭 boardgame.io 的动作计数，
      //   否则默认 maxMoves=1 会在每人出一张牌后自动 EndStage，把人踢出 activePlayers。
      // client: false —— 禁止客户端拿本地状态做乐观执行。
      //   客户端手里只有 playerView 过滤后的视图（没有他人手牌、水晶等），
      //   引擎在这个视图上根本跑不起来，乐观执行必然抛错并刷出 "invalid move"。
      //   所有动作一律只由 master 执行，结果再回传。
      passCoin: {
        noLimit: true,
        client: false,
        move: ({ G, playerID }, to: string) =>
          run(G, { type: 'passCoin', playerId: toPlayerId(playerID), to }),
      },

      resolveMagicTargets: {
        noLimit: true,
        client: false,
        move: ({ G, playerID }, targets: string[]) =>
          run(G, { type: 'resolveMagicTargets', playerId: toPlayerId(playerID), targets }),
      },

      chooseGoLast: {
        noLimit: true,
        client: false,
        move: ({ G, playerID }) =>
          run(G, { type: 'chooseGoLast', playerId: toPlayerId(playerID) }),
      },

      playCard: {
        noLimit: true,
        client: false,
        move: ({ G, playerID }, cardId: string) =>
          run(G, { type: 'playCard', playerId: toPlayerId(playerID), cardId }),
      },

      /** 3 号扩充：随机出牌轮——玩家选择出牌，牌由引擎随机抽（不接受 cardId） */
      playRandom: {
        noLimit: true,
        client: false,
        move: ({ G, playerID }) => run(G, { type: 'playRandom', playerId: toPlayerId(playerID) }),
      },

      passTurn: {
        noLimit: true,
        client: false,
        move: ({ G, playerID }) => run(G, { type: 'passTurn', playerId: toPlayerId(playerID) }),
      },

      /** 6 号扩充：公开前指定一名未出牌玩家随机补出一张 */
      pickPreShuffleTarget: {
        noLimit: true,
        client: false,
        move: ({ G, playerID }, targetId: string) =>
          run(G, {
            type: 'pickPreShuffleTarget',
            playerId: toPlayerId(playerID),
            targetId,
          }),
      },

      resolveRedraw: {
        noLimit: true,
        client: false,
        move: ({ G, playerID }, targetId?: string) =>
          run(G, { type: 'resolveRedraw', playerId: toPlayerId(playerID), targetId }),
      },
    },

    playerView: ({ G, playerID }): GameView => enginePlayerView(G, toPlayerId(playerID)),

    endIf: ({ G }) => (G.winner ? { winner: G.winner, reason: G.winReason } : undefined),
  };
}

/**
 * game 名称：官方配比固定为 'blades-and-rose'；自定义配比按配比签名生成变体名。
 *
 * 联机时这个名称同时是 socket.io 的命名空间——服务器为每个配比变体注册一个
 * game（见 src/server/dev-server.ts），客户端按 URL 中的配比选择同名 game，
 * 不同配比的玩家因此天然进入不同对局。
 */
export function gameNameOf(override: Partial<Distribution> | null): string {
  if (!override) return 'blades-and-rose';
  // 签名用下划线分隔：socket.io 的 URL 中逗号是多命名空间分隔符，不能出现在名称里
  return `blades-and-rose-${ROLE_ORDER.map((role) => override[role] ?? '*').join('_')}`;
}

/**
 * 从 game 变体名反解配比（回主页自动拉回时用：服务器只回 gameName，客户端要据此选同一个 game）：
 *   'blades-and-rose'                 → null（官方配比）
 *   'blades-and-rose-1_0_2_0_1_1'     → Distribution（签名用下划线分隔，与 gameNameOf 对应）
 * 无法识别（前缀不符 / 段数不对 / 不是非负整数）→ undefined，调用方据此放弃自动进入；
 * 合计是否等于人数由调用方再用 validateDistribution 复核。
 */
export function distributionOfGameName(gameName: string): Distribution | null | undefined {
  const official = gameNameOf(null);
  if (gameName === official) return null;
  const prefix = `${official}-`;
  if (!gameName.startsWith(prefix)) return undefined;
  const parts = gameName.slice(prefix.length).split('_');
  if (parts.length !== ROLE_ORDER.length) return undefined;
  const counts = parts.map((part) => Number(part));
  if (counts.some((value) => !Number.isInteger(value) || value < 0)) return undefined;
  const distribution = {} as Distribution;
  ROLE_ORDER.forEach((role, index) => {
    distribution[role] = counts[index]!;
  });
  return distribution;
}

const gameCache = new Map<string, Game<GameState>>();

/**
 * 按配比复用 game 对象。
 *
 * boardgame.io 的 Local() 传输器把 game 对象「引用」本身当作 master 的缓存键
 * （client 里 `gameKey: game`），所以：
 *   - 相同配比返回同一个对象 → 复用同一个 master → 重设后回到同一配比能继续原局；
 *   - 不同配比返回新对象 → 全新的 master → 不会读到旧配比遗留的对局状态。
 */
export function getBladesAndRose(
  override: Partial<Distribution> | null,
  loadout: SkillLoadout | null = null,
): Game<GameState> {
  // 技能组不同的热座对局必须用不同的 game 对象（否则 Local 传输器会复用同一个 master）
  const key = loadout ? `${gameNameOf(override)}|${loadoutSignature(loadout)}` : gameNameOf(override);
  let game = gameCache.get(key);
  if (!game) {
    game = createBladesAndRose(override, loadout);
    gameCache.set(key, game);
  }
  return game;
}

/**
 * 官方配比的单例。
 * 必须走 getBladesAndRose 而不是直接 createBladesAndRose，
 * 否则官方配比会存在两个不同的 game 对象，也就有两个 master。
 */
export const BladesAndRose = getBladesAndRose(null);
