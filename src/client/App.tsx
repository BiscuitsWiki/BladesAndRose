import type { BoardProps } from 'boardgame.io/react';
import { Client } from 'boardgame.io/react';
import { Local, SocketIO } from 'boardgame.io/multiplayer';
import { useEffect, useMemo, useRef, useState, type ComponentType, type Dispatch, type SetStateAction } from 'react';
import {
  LOADOUT_BASE,
  LOADOUT_PRESETS,
  distributionSignature,
  loadoutSignature,
  officialDistribution,
  parseDistribution,
  validateDistribution,
  type Distribution,
  type GameState,
  type SkillLoadout,
} from '../engine';
import { Board } from './board/Board';
import { ensureGuestAccount, loadAccount, type LocalAccount } from './account';
import { CopyButton, PencilIcon, copyTextToClipboard } from './CopyButton';
import { isOfficialDistribution } from './distribution';
import { Lobby, PLAYER_COUNTS } from './lobby/Lobby';
import { distributionOfGameName, gameNameOf, getBladesAndRose } from './game';
import { RoomPanel } from './room/RoomPanel';
import {
  claimSeat,
  fetchActiveGame,
  fetchRoomInfo,
  joinRoom,
  leaveSeat,
  loadCredentials,
  loadNickname,
  renameRoom,
  resetRoom,
  serverBase,
  setRoomSkills,
  spectateHeartbeat,
  startRoom,
  transferHost,
  type ActiveGame,
  type RoomInfo,
} from './room';

function readHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const players = Number(params.get('players'));
  const spectate = params.get('spectate') === '1';
  const seat = params.get('seat');
  const room = (params.get('room') ?? '').trim() || null;
  const dist = parseDistribution(params.get('d') ?? '');
  /** 逃生阀：带 lobby=1 时即使有进行中的对局也留在大厅（调试用；进入房间后自然清掉） */
  const forceLobby = params.get('lobby') === '1';
  // 配比非法（合计不符、白蔷薇/暗刃不为 1 等）时不直接进对局，回落到大厅重新编辑
  const distValid = dist === null || validateDistribution(dist, players) === null;
  const seatValid =
    seat !== null && seat !== '' && Number(seat) >= 0 && Number(seat) < players;
  const valid =
    PLAYER_COUNTS.includes(players) && (spectate ? room !== null : seatValid) && distValid;
  return { players, seat: spectate ? null : seat, room, dist, valid, forceLobby };
}

function buildHash(
  count: number,
  seat: string | null,
  distribution: Distribution,
  room: string | null,
): string {
  const params = new URLSearchParams({ players: String(count) });
  if (seat === null) params.set('spectate', '1');
  else params.set('seat', seat);
  if (room !== null) params.set('room', room);
  if (!isOfficialDistribution(count, distribution)) {
    params.set('d', distributionSignature(distribution));
  }
  return `#${params.toString()}`;
}

interface SetupState {
  count: number;
  distribution: Distribution;
  /** 联机：座位号；null 表示观战席（热座恒为座位号） */
  seat: string | null;
  /** 联机房间号；null 表示本地热座 */
  room: string | null;
  /** 联机座位的认证凭据（join 获得）；观战与热座为 null */
  credentials: string | null;
  nickname: string;
  inGame: boolean;
}

export function App() {
  const initial = useMemo(readHash, []);
  /** 「主页」状态（无 room、无 seat、未强制大厅）：先查有没有进行中的对局，再决定进房间还是留在大厅 */
  const needsResumeCheck = initial.room === null && initial.seat === null && !initial.forceLobby;
  const [checkingGame, setCheckingGame] = useState(needsResumeCheck);
  /** 本机身份（游客 / 专属账号）；服务器不可用时为 null，不阻塞大厅使用 */
  const [account, setAccount] = useState<LocalAccount | null>(loadAccount);
  const [setup, setSetup] = useState<SetupState>(() => {
    if (initial.valid && initial.room === null) {
      return {
        count: initial.players,
        distribution: initial.dist ?? officialDistribution(initial.players),
        seat: initial.seat,
        room: null,
        credentials: null,
        nickname: '',
        inGame: true,
      };
    }
    if (initial.valid && initial.room !== null) {
      const distribution = initial.dist ?? officialDistribution(initial.players);
      const override = isOfficialDistribution(initial.players, distribution) ? null : distribution;
      const nickname = loadNickname();
      if (initial.seat === null) {
        // 观战席：无需凭据，直接进入（界面只显示公开信息）
        return {
          count: initial.players,
          distribution,
          seat: null,
          room: initial.room,
          credentials: null,
          nickname,
          inGame: true,
        };
      }
      // 本机已有该座位的凭据（刷新 / 重连）时直接进入；否则落大厅，重新进入房间时再认证
      const credentials = loadCredentials(gameNameOf(override), initial.room, initial.seat);
      return {
        count: initial.players,
        distribution,
        seat: initial.seat,
        room: initial.room,
        credentials,
        nickname,
        inGame: credentials !== null,
      };
    }
    return {
      count: 5,
      distribution: officialDistribution(5),
      seat: null,
      room: null,
      credentials: null,
      nickname: '',
      inGame: false,
    };
  });

  /**
   * 「睁眼」标注（按视角各记一份，只存在本机、不进对局状态）。
   * 放在 App 层而不是 Board 内：热座切换视角会重建 boardgame.io client（见下），
   * Board 随之重新挂载，标注放这里才不会因切换视角而丢失。
   */
  const [eyeMarks, setEyeMarks] = useState<Record<string, string[]>>({});

  /** 热座技能组（默认初版）；联机对局由服务器经 setupData 决定，与此无关 */
  const [hotseatLoadout, setHotseatLoadout] = useState<SkillLoadout>(() => ({ ...LOADOUT_BASE }));

  const official = isOfficialDistribution(setup.count, setup.distribution);
  const override = official ? null : setup.distribution;
  // 配比的稳定字面量，用它代替对象依赖
  const overrideKey = official ? 'official' : distributionSignature(setup.distribution);
  /** 「重开」的二次确认弹窗：防止误触清空房间 */
  const [confirmRestart, setConfirmRestart] = useState(false);
  /** 房间面板数据（座位占用 / 观战者 / 房间名），联机时每 3 秒刷新 */
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  /** 入座 / 改名的错误提示（显示在房间面板里） */
  const [roomError, setRoomError] = useState<string | null>(null);
  /** 房主改名：null 表示未在编辑 */
  const [renameValue, setRenameValue] = useState<string | null>(null);
  /** 复制反馈：刚刚复制了哪一项 */
  const [copied, setCopied] = useState<'name' | 'code' | 'uid' | null>(null);
  /** 「转移房主」模式：点击一个已入座玩家，把房主转给他 */
  const [transferMode, setTransferMode] = useState(false);
  /** 正在切换到的座位号（换座请求进行中：格子先禁用并给出反馈） */
  const [seatBusy, setSeatBusy] = useState<string | null>(null);
  /** 退回大厅时的提示（房间被销毁 / 房间服务器重启） */
  const [lobbyNotice, setLobbyNotice] = useState<string | null>(null);
  /** 开局状态：热座直接开局；联机由服务器的 started 决定（每 3 秒轮询刷新） */
  const started = setup.room === null || roomInfo?.started === true;
  /** 房主：服务器按房间记录（创建房间的玩家即房主，可转移），与座位号无关 */
  const hostSeat = roomInfo?.hostSeat ?? null;
  const isHost = setup.seat !== null && setup.seat === hostSeat;

  /** 复制房间名称 / 房间号 / UID，并短暂显示「已复制」 */
  async function copyField(kind: 'name' | 'code' | 'uid', text: string) {
    if (text === '') return;
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    } else {
      setRoomError('复制失败：浏览器未授予剪贴板权限，可手动选中复制');
    }
  }

  useEffect(() => {
    if (setup.room === null || !setup.inGame) return;
    const room = setup.room;
    let alive = true;
    const load = async () => {
      try {
        const info = await fetchRoomInfo(room);
        if (alive) setRoomInfo(info);
      } catch {
        // 网络抖动时保留上一次信息
      }
    };
    void load();
    const timer = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [setup.room, setup.inGame]);

  // 观战心跳：停留在观战席期间定期上报，房间面板据此显示观战者
  useEffect(() => {
    if (setup.room === null || !setup.inGame || setup.seat !== null) return;
    const room = setup.room;
    const tick = () => void spectateHeartbeat(room, setup.nickname || '观战者');
    tick();
    const timer = window.setInterval(tick, 20000);
    return () => window.clearInterval(timer);
  }, [setup.room, setup.inGame, setup.seat, setup.nickname]);

  /**
   * 断线被移出座位（未开局时超过 1 分钟未重连，服务器按退出处理）后的自动归位：
   * 我的座位空着 → 自动重新入座（若对局已被清空会先重新建房）；已被别人占走 → 转观战席。
   * 对局进行中座位不会被释放（断线超 3 分钟由 AI 托管），因此这里不会触发。
   */
  const reclaiming = useRef(false);
  useEffect(() => {
    if (setup.room === null || !setup.inGame || setup.seat === null || roomInfo === null) return;
    // 有座位操作在进行（手动换座 / 归位中）时让位：否则轮询到的中间态会触发重复入座
    if (seatBusy !== null || reclaiming.current) return;
    if (!roomInfo.exists && !roomInfo.retained) return; // 房间已销毁：不自动入座
    const seat = setup.seat;
    const occupant = roomInfo.seats[seat];
    if (occupant === undefined) {
      reclaiming.current = true;
      setSeatBusy(seat);
      const room = setup.room;
      void (async () => {
        try {
          const credentials = await joinRoom({
            room,
            seat,
            count: setup.count,
            override,
            nickname: setup.nickname || `玩家 ${Number(seat) + 1}`,
            uid: account?.uid ?? null,
          });
          setSetup((prev) => ({ ...prev, credentials }));
          setRoomInfo(await fetchRoomInfo(room));
        } catch {
          setSetup((prev) => ({ ...prev, seat: null, credentials: null }));
          setRoomError('重新入座失败，已进入观战席（点击空位可重新入座）');
        } finally {
          reclaiming.current = false;
          setSeatBusy(null);
        }
      })();
      return;
    }
    if (setup.nickname !== '' && occupant !== setup.nickname) {
      // 座位已被别人占走：转观战席（不能冒用他人座位）
      setSetup((prev) => ({ ...prev, seat: null, credentials: null }));
      setRoomError('你原来的座位已被别人占用，已进入观战席（点击空位可重新入座）');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.room, setup.inGame, setup.seat, setup.count, setup.nickname, overrideKey, roomInfo, seatBusy, account]);

  /** 房间已不存在（空置超时被销毁 / 房间服务器重启）：退回大厅并说明，避免卡在没有房间的页面 */
  useEffect(() => {
    if (setup.room === null || !setup.inGame || roomInfo === null) return;
    if (roomInfo.exists || roomInfo.retained) return;
    window.history.replaceState(null, '', `#players=${setup.count}`);
    setLobbyNotice('房间已不存在（空置超时被销毁，或房间服务器重启过）。请重新创建房间，或用新的房间号进入。');
    setRoomInfo(null);
    setSetup((prev) => ({ ...prev, inGame: false }));
  }, [setup.room, setup.inGame, roomInfo, setup.count]);

  /**
   * 用 UID 拉回「进行中的对局」：查到就自动进入房间继续游戏（回主页、登录成功后都会尝试）。
   * 无法识别配比 / 座位已被别人占走 / 房间已被清空时不进入，留在大厅并给出提示。
   */
  async function resumeActiveGame(uid: string): Promise<void> {
    const game: ActiveGame | null = await fetchActiveGame(uid);
    if (game === null) return;
    const distribution = distributionOfGameName(game.gameName);
    const count = game.numPlayers;
    if (distribution === undefined) {
      setLobbyNotice('检测到进行中的对局，但无法识别它的角色配比，已回到大厅（可手动输入房间号进入）。');
      return;
    }
    const resolved = distribution ?? officialDistribution(count);
    if (validateDistribution(resolved, count) !== null) {
      setLobbyNotice('检测到进行中的对局，但配比与人数对不上，已回到大厅。');
      return;
    }
    const override = isOfficialDistribution(count, resolved) ? null : resolved;
    const nickname = loadNickname() || game.name || `玩家 ${Number(game.seat) + 1}`;
    const credentials = await claimSeat({
      room: game.room,
      seat: game.seat,
      uid,
      playerName: nickname,
      override,
      count,
    });
    window.history.replaceState(null, '', buildHash(count, game.seat, resolved, game.room));
    setRoomInfo(null);
    setLobbyNotice(null);
    setSetup({
      count,
      distribution: resolved,
      seat: game.seat,
      room: game.room,
      credentials,
      nickname,
      inGame: true,
    });
  }

  /**
   * 启动检查（只跑一次）：确保本机有玩家身份（没有就领一个游客 UID），
   * 并在「主页」状态下尝试拉回进行中的对局；完成后放行大厅渲染。
   */
  const bootChecked = useRef(false);
  useEffect(() => {
    if (bootChecked.current) return;
    bootChecked.current = true;
    let alive = true;
    void (async () => {
      let current = account;
      if (current === null) {
        try {
          current = await ensureGuestAccount();
          if (alive) setAccount(current);
        } catch (error) {
          if (alive) setLobbyNotice(`未能取得玩家身份：${(error as Error).message}`);
        }
      }
      if (!alive) return;
      if (!needsResumeCheck || current === null) {
        setCheckingGame(false);
        return;
      }
      try {
        await resumeActiveGame(current.uid);
      } catch (error) {
        if (alive) setLobbyNotice(`自动进入进行中的对局失败：${(error as Error).message}`);
      } finally {
        if (alive) setCheckingGame(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 热座「当前视角」切换时**重建 client**，而不是用 boardgame.io 的 updatePlayerID：
   * Local() 传输器按 playerID 累积回调且永不注销，master 的 sendAll 会把同一份状态给
   * 所有访问过的座位各发一份、最后由「座位号最大者」覆盖写入同一个 store——于是状态一推进，
   * 当前视角就可能拿到别人的过滤视图（表现：「你的手牌」面板消失、无法出牌）。
   * 重建 client 后，过期回调落在已卸载的旧 client 上（其 store 不再被渲染），
   * 当前 client 只会收到自己的视图。对局本身不受影响：Local master 按 game 对象缓存，
   * 新建的 client 会重新同步到同一局。
   */
  /**
   * BoardGameClient 的重建钥匙：
   *   - 热座：技能组签名（本地换技能组 = 换 game 对象与 master）；
   *   - 联机：等待开局期间纳入房内技能组签名——房主改技能组后（服务器原地改写 G.skills、不清局），
   *     各客户端轮询到 skillset 变化即重建连接并重新同步，牌桌随之刷新；开局后不再随技能组重建
   *     （开局后也不允许改），避免开局瞬间多一次无谓重连。
   */
  const roomSkillsetKey =
    roomInfo === null || roomInfo.started
      ? 'online'
      : `online:${roomInfo.skillset?.sig ?? roomInfo.skillset?.id ?? 'custom'}`;
  const hotseatKey = setup.room === null ? loadoutSignature(hotseatLoadout) : roomSkillsetKey;
  const BoardGameClient = useMemo(
    () =>
      // boardgame.io 的 Client 组件会在运行时把额外 props 透传给 board，
      // 但类型上未开放，这里显式断言我们实际传入的 props
      Client({
        game: getBladesAndRose(override, setup.room === null ? hotseatLoadout : null),
        board: Board as unknown as ComponentType<BoardProps<GameState>>,
        numPlayers: setup.count,
        // 有房间号 -> 联机模式，经房间服务器走 SocketIO；否则单页热座走 Local
        multiplayer: setup.room ? SocketIO({ server: serverBase() }) : Local(),
      }) as unknown as ComponentType<{
        playerID?: string;
        matchID: string;
        credentials?: string;
        online?: boolean;
        spectating?: boolean;
        /** 服务器下发的座位在线状态（联机才有；null 时 Board 回退到 matchData 的 isConnected） */
        seatStatus?: { offline: string[]; ai: string[] } | null;
        /** 「睁眼」标注（按视角各记一份，App 层持有，见上） */
        eyeMarks: Record<string, string[]>;
        setEyeMarks: Dispatch<SetStateAction<Record<string, string[]>>>;
      }>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setup.count, overrideKey, setup.room, setup.seat, hotseatKey],
  );

  if (checkingGame) {
    return (
      <>
        <div className="topbar">
          <strong>血与刃的白蔷薇</strong>
        </div>
        <div className="panel">
          <h2>正在检测进行中的对局…</h2>
          <p className="dim">
            如果你的账号有未打完的对局，会自动进入房间继续；没有就留在大厅。
          </p>
        </div>
      </>
    );
  }

  if (!setup.inGame) {
    return (
      <Lobby
        initialCount={setup.count}
        initialDistribution={setup.distribution}
        initialRoom={setup.room}
        notice={lobbyNotice ?? undefined}
        account={account}
        loadout={hotseatLoadout}
        onLoadoutChange={setHotseatLoadout}
        onAccountChange={setAccount}
        onResume={(next) => {
          setAccount(next);
          void resumeActiveGame(next.uid).catch((error) =>
            setLobbyNotice((error as Error).message),
          );
        }}
        onPick={(count, distribution, seat, room, credentials, nickname) => {
          window.history.replaceState(null, '', buildHash(count, seat, distribution, room));
          setRoomInfo(null); // 进新房间先丢掉旧房间信息，避免沿用旧的「已开局」状态
          setLobbyNotice(null);
          setSetup({ count, distribution, seat, room, credentials, nickname, inGame: true });
        }}
      />
    );
  }

  const switchSeat = (seat: string) => {
    window.history.replaceState(
      null,
      '',
      buildHash(setup.count, seat, setup.distribution, setup.room),
    );
    setSetup((prev) => ({ ...prev, seat }));
  };

  /**
   * 房主重开：经服务器校验凭据后删除整个房间，回到房间页重新配置。
   * 房间号保留，重新进入时按新配置自动建房；其他玩家刷新后重新加入
   * （本地旧凭据在房间不存在时会自动走「建房 → 重新加入」流程）。
   */
  async function restartRoom() {
    if (setup.room === null || setup.seat === null || setup.credentials === null) return;
    try {
      await resetRoom({
        room: setup.room,
        seat: setup.seat,
        override,
        credentials: setup.credentials,
      });
    } catch (error) {
      console.warn('[blades-and-rose] 重置房间失败：', error);
    }
    setSetup((prev) => ({ ...prev, inGame: false }));
    // 旧的「已开局」状态不要带进下一次进入房间
    setRoomInfo(null);
  }

  /**
   * 入座 / 换座：先加入目标座位（旧座位暂时保留——房主转移需要旧座位的凭据仍然有效），
   * 房主换座则先把房主身份带到新座位，最后释放旧座位；任何一步失败都留在原座位。
   */
  async function takeSeat(targetSeat: string) {
    if (setup.room === null || setup.seat === targetSeat) return;
    setRoomError(null);
    setTransferMode(false);
    setSeatBusy(targetSeat);
    const oldSeat = setup.seat;
    const oldCredentials = setup.credentials;
    try {
      const credentials = await joinRoom({
        room: setup.room,
        seat: targetSeat,
        count: setup.count,
        override,
        nickname: setup.nickname || `玩家 ${Number(targetSeat) + 1}`,
        uid: account?.uid ?? null,
      });
      if (oldSeat !== null && oldCredentials !== null && hostSeat === oldSeat) {
        try {
          await transferHost({
            room: setup.room,
            seat: oldSeat,
            credentials: oldCredentials,
            targetSeat,
          });
        } catch (transferFailure) {
          // 房主转移失败：撤销刚加入的新座位，留在原座位以免丢掉房主身份
          await leaveSeat({ room: setup.room, seat: targetSeat, override, credentials }).catch(
            () => undefined,
          );
          throw transferFailure;
        }
      }
      if (oldSeat !== null && oldCredentials !== null) {
        try {
          await leaveSeat({
            room: setup.room,
            seat: oldSeat,
            override,
            credentials: oldCredentials,
          });
        } catch {
          setRoomError('旧座位释放失败，刷新页面即可恢复一致');
        }
      }
      window.history.replaceState(
        null,
        '',
        buildHash(setup.count, targetSeat, setup.distribution, setup.room),
      );
      // 先取回最新房间信息，再和座位一起提交：避免自动归位逻辑在「已换到新座位、面板还是旧数据」的间隙误判
      let freshInfo: RoomInfo | null = null;
      try {
        freshInfo = await fetchRoomInfo(setup.room);
      } catch {
        // 失败也无妨：轮询会兜底
      }
      setSetup((prev) => ({ ...prev, seat: targetSeat, credentials }));
      if (freshInfo !== null) setRoomInfo(freshInfo);
    } catch (failure) {
      setRoomError((failure as Error).message);
    } finally {
      setSeatBusy(null);
    }
  }

  /** 房主显式转移房主：把房主转给某个已入座玩家 */
  async function transferHostTo(targetSeat: string) {
    if (setup.room === null || setup.seat === null || setup.credentials === null) return;
    setRoomError(null);
    try {
      await transferHost({
        room: setup.room,
        seat: setup.seat,
        credentials: setup.credentials,
        targetSeat,
      });
      setTransferMode(false);
      setRoomInfo(await fetchRoomInfo(setup.room));
    } catch (failure) {
      setRoomError((failure as Error).message);
    }
  }

  /** 房主开局：服务器置 started 后，各客户端最多 3 秒（轮询）内显示牌桌 */
  async function startGame() {
    if (setup.room === null || setup.seat === null || setup.credentials === null) return;
    setRoomError(null);
    try {
      await startRoom({
        room: setup.room,
        seat: setup.seat,
        credentials: setup.credentials,
      });
      setRoomInfo(await fetchRoomInfo(setup.room));
    } catch (failure) {
      setRoomError((failure as Error).message);
    }
  }

  /** 房主保存房间名 */
  async function saveRoomName() {
    if (
      setup.room === null ||
      setup.seat === null ||
      setup.credentials === null ||
      renameValue === null
    ) {
      return;
    }
    const name = renameValue.trim();
    if (name === '') return;
    try {
      await renameRoom({
        room: setup.room,
        seat: setup.seat,
        credentials: setup.credentials,
        name,
      });
      setRenameValue(null);
      setRoomInfo(await fetchRoomInfo(setup.room));
    } catch (failure) {
      setRoomError((failure as Error).message);
    }
  }

  /**
   * 房主修改房间技能组：服务器把新技能组原地写入等待中的对局（不清局、不踢人），
   * 各客户端轮询到 skillset 签名变化后自动重连刷新牌桌，无需任何手动操作。
   */
  async function saveRoomSkills(presetId: string) {
    if (setup.room === null || setup.seat === null || setup.credentials === null) return;
    const preset = LOADOUT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setRoomError(null);
    try {
      await setRoomSkills({
        room: setup.room,
        seat: setup.seat,
        credentials: setup.credentials,
        loadout: preset.loadout,
      });
      setRoomInfo(await fetchRoomInfo(setup.room));
    } catch (failure) {
      setRoomError((failure as Error).message);
    }
  }

  return (
    <>
      <div className="topbar">
        <strong>血与刃的白蔷薇</strong>
        {setup.room === null ? (
          <>
            <span className="dim">
              {setup.count} 人局{official ? '（官方配比）' : '（自定义配比）'}
            </span>
            <span className="seats">
              <span className="dim">当前视角：</span>
              {Array.from({ length: setup.count }, (_, i) => (
                <button
                  key={i}
                  className={`btn small${setup.seat === String(i) ? ' primary' : ''}`}
                  onClick={() => switchSeat(String(i))}
                >
                  座位 {i + 1}
                </button>
              ))}
            </span>
            <button className="btn" onClick={() => setSetup((prev) => ({ ...prev, inGame: false }))}>
              重设
            </button>
          </>
        ) : (
          <>
            {renameValue === null ? (
              <span className="room-chip">
                <span className="room-title">{roomInfo?.name ?? '房间'}</span>
                {isHost && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="编辑房间名称"
                    title="编辑房间名称（房主）"
                    onClick={() => {
                      setRoomError(null);
                      setRenameValue(roomInfo?.name ?? '');
                    }}
                  >
                    <PencilIcon />
                  </button>
                )}
                <CopyButton
                  label="复制房间名称"
                  copied={copied === 'name'}
                  onCopy={() => void copyField('name', roomInfo?.name ?? '')}
                />
              </span>
            ) : (
              <>
                <input
                  className="room-input"
                  value={renameValue}
                  maxLength={24}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveRoomName();
                    if (e.key === 'Escape') setRenameValue(null);
                  }}
                />
                <button className="btn small" onClick={() => void saveRoomName()}>
                  保存
                </button>
                <button className="btn small" onClick={() => setRenameValue(null)}>
                  取消
                </button>
              </>
            )}
            <span className="room-chip">
              <span className="dim">房间号 {setup.room}</span>
              <CopyButton
                label="复制房间号"
                copied={copied === 'code'}
                onCopy={() => void copyField('code', setup.room ?? '')}
              />
            </span>
            <span className="dim">
              {setup.seat === null ? '观战中' : `你的座位：座位 ${Number(setup.seat) + 1}`}
            </span>
            {account !== null && (
              <span className="room-chip" title="你的玩家 UID">
                <span className="dim">
                  {account.kind === 'account' ? '专属账号' : '游客'} · UID {account.uid}
                </span>
                <CopyButton
                  label="复制 UID"
                  copied={copied === 'uid'}
                  onCopy={() => void copyField('uid', account.uid)}
                />
              </span>
            )}
            {isHost && (
              <button
                className="btn"
                onClick={() => setConfirmRestart(true)}
                title="退回房间重新分配（清空当前对局，其他玩家刷新后重新加入）"
              >
                重开
              </button>
            )}
          </>
        )}
      </div>
      <p className="dim notice">
        {setup.room !== null ? (
          <>
            联机模式：
            {setup.seat === null
              ? '你在观战席——只能看到公开信息，点击空座位即可入座'
              : `本窗口固定为「座位 ${Number(setup.seat) + 1}」，只渲染该座位能看到的 playerView`}
            。房间号 {setup.room}；房主为创建房间的玩家，可在座位面板转移房主。
          </>
        ) : (
          <>
            单页热座：同一局里切换「当前视角」即可替不同座位行动，界面只会渲染该座位能看到的
            <code>playerView</code>。切换时请让其他玩家回避。
          </>
        )}
      </p>
      {setup.room !== null && roomInfo !== null && (
        <RoomPanel
          count={setup.count}
          mySeat={setup.seat}
          info={roomInfo}
          error={roomError}
          started={started}
          isHost={isHost}
          transferMode={transferMode}
          busy={seatBusy !== null}
          onStart={() => void startGame()}
          onToggleTransfer={() => setTransferMode((prev) => !prev)}
          onTransferHost={(seat) => void transferHostTo(seat)}
          onTakeSeat={(seat) => void takeSeat(seat)}
          onSetSkills={(presetId) => void saveRoomSkills(presetId)}
        />
      )}
      {setup.room !== null && !started && (
        <div className="panel">
          <h2>等待开局</h2>
          <p className="dim">
            {setup.seat === null
              ? '你在观战席：等待房主点击「开始游戏」，开局后即可看到牌桌的公开信息。'
              : `房主${hostSeat !== null ? `（座位 ${Number(hostSeat) + 1}）` : ''}点击上方座位面板里的「开始游戏」后，这里会显示牌桌。`}
          </p>
        </div>
      )}
      {/* 开局前牌桌隐藏但保持连接：座位凭据校验、刷新重连、自动建房都照常工作 */}
      <div className={setup.room !== null && !started ? 'board-hidden' : undefined}>
        <BoardGameClient
          playerID={setup.seat ?? undefined}
          matchID={setup.room ?? `n${setup.count}`}
          credentials={setup.credentials ?? undefined}
          online={setup.room !== null}
          spectating={setup.room !== null && setup.seat === null}
          seatStatus={
            roomInfo === null
              ? null
              : { offline: roomInfo.offline, ai: roomInfo.ai ?? [] }
          }
          eyeMarks={eyeMarks}
          setEyeMarks={setEyeMarks}
        />
      </div>
      {confirmRestart && (
        <div className="modal-mask" onClick={() => setConfirmRestart(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <p>重开将清空当前对局并退回房间，重新分配座位与配比；其他玩家需刷新页面重新加入。</p>
            <div className="actions">
              <button
                className="btn primary"
                onClick={() => {
                  setConfirmRestart(false);
                  void restartRoom();
                }}
              >
                确认重开
              </button>
              <button className="btn" onClick={() => setConfirmRestart(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
