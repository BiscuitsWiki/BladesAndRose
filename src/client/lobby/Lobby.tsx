import { useState } from 'react';
import {
  LOADOUT_PRESETS,
  officialDistribution,
  sameLoadout,
  validateDistribution,
  type Distribution,
  type SkillLoadout,
} from '../../engine';
import { HallEmblem } from '../artwork';
import { AccountBar } from '../AccountBar';
import { DistributionEditor } from './DistributionEditor';
import { LoadoutChips, loadoutSummary } from '../LoadoutChips';
import { isOfficialDistribution } from '../distribution';
import { type LocalAccount } from '../account';
import {
  createRoom,
  fetchRoomInfo,
  joinRoom,
  loadNickname,
  newRoomCode,
  saveNickname,
} from '../room';

export const PLAYER_COUNTS = [5, 6, 7, 8, 9, 10];

export function Lobby({
  initialCount,
  initialDistribution,
  initialRoom,
  notice,
  account,
  loadout,
  onLoadoutChange,
  onAccountChange,
  onResume,
  onPick,
}: {
  initialCount: number;
  initialDistribution: Distribution;
  initialRoom: string | null;
  /** 从房间页退回大厅时的提示（房间已销毁等） */
  notice?: string;
  /** 本机身份（游客 / 专属账号），显示在大厅顶部 */
  account: LocalAccount | null;
  /** 热座技能组（联机对局采用房内技能组，与此无关） */
  loadout: SkillLoadout;
  onLoadoutChange: (loadout: SkillLoadout) => void;
  onAccountChange: (account: LocalAccount | null) => void;
  /** 注册 / 登录成功：查一查该 UID 有没有进行中的对局，有就拉回 */
  onResume: (account: LocalAccount) => void;
  onPick: (
    count: number,
    distribution: Distribution,
    seat: string | null,
    room: string | null,
    credentials: string | null,
    nickname: string,
  ) => void;
}) {
  const [count, setCount] = useState(initialCount);
  const [customs, setCustoms] = useState<Record<number, Distribution>>(() => ({
    [initialCount]: initialDistribution,
  }));
  const [room, setRoom] = useState(initialRoom ?? '');
  const [roomTitle, setRoomTitle] = useState('');
  const [nickname, setNickname] = useState(loadNickname());
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(notice ?? null);

  const distribution = customs[count] ?? officialDistribution(count);
  const error = validateDistribution(distribution, count);
  const roomName = room.trim();

  /**
   * 进入联机房间：创建时先生成房间码并把房间建出来；
   * 座位自动分配（第一个空位），坐满则进观战席。
   */
  async function enterOnline(createNew: boolean) {
    const nick = nickname.trim();
    if (nick === '') {
      setJoinError('请先填写昵称');
      return;
    }
    if (!createNew && roomName === '') {
      setJoinError('请输入房间号，或点击「创建房间」');
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const override = isOfficialDistribution(count, distribution) ? null : distribution;
      let target = roomName;
      if (createNew) {
        target = await newRoomCode(roomTitle.trim());
        await createRoom(target, count, override);
        setRoom(target);
      }
      const info = await fetchRoomInfo(target, account?.uid ?? null);
      // 留存期内的空房间（信息还在、没有在座在线玩家）可以进：入座时会重新开局，入座者成为房主
      if (!info.exists && !info.retained) throw new Error('房间不存在（或已销毁），请检查房间号');
      if (info.numPlayers !== undefined && info.numPlayers !== count) {
        throw new Error(`该房间是 ${info.numPlayers} 人局，请先把人数调整为 ${info.numPlayers}`);
      }
      const freeSeat = Array.from({ length: count }, (_, i) => String(i)).find(
        (seat) => !info.seats[seat],
      );
      saveNickname(nick);
      // 优先收回本 UID 在这个房间绑定的座位（凭据丢了也能回来）；否则坐第一个空位
      const targetSeat = info.mySeat ?? freeSeat;
      if (targetSeat === undefined) {
        onPick(count, distribution, null, target, null, nick); // 座位已满：进观战席
        return;
      }
      const credentials = await joinRoom({
        room: target,
        seat: targetSeat,
        count,
        override,
        nickname: nick,
        uid: account?.uid ?? null,
      });
      onPick(count, distribution, targetSeat, target, credentials, nick);
    } catch (joinFailure) {
      setJoinError((joinFailure as Error).message);
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="lobby">
      <header className="lobby-head">
        <HallEmblem />
        <h1>血与刃的白蔷薇</h1>
        <p className="dim">
          本地热座验证：先选人数与座位进入对局，之后用顶部的「当前视角」切换座位。
        </p>
      </header>
      <AccountBar account={account} onAccountChange={onAccountChange} onResume={onResume} />
      <div className="actions">
        <span className="dim">你的昵称：</span>
        <input
          className="room-input"
          placeholder="昵称"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <span className="dim">（联机时显示在座位格子与牌桌上，会记住在本机）</span>
      </div>

      <section className="lobby-sec">
        <h2>1 · 玩家人数</h2>
        <div className="actions">
          {PLAYER_COUNTS.map((n) => (
            <button
              key={n}
              className={`btn${count === n ? ' primary' : ''}`}
              onClick={() => setCount(n)}
            >
              {n} 人
            </button>
          ))}
        </div>
      </section>

      <section className="lobby-sec">
        <h2>2 · 角色配比</h2>
        <DistributionEditor
          count={count}
          value={distribution}
          onChange={(next) => setCustoms((prev) => ({ ...prev, [count]: next }))}
        />
      </section>

      <section className="lobby-sec">
        <h2>3 · 本地热座（调试）</h2>
        <div className="actions">
          <span className="dim">技能组：</span>
          {LOADOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={`btn small${sameLoadout(loadout, preset.loadout) ? ' primary' : ''}`}
              title={`${preset.name}技能表：${loadoutSummary(preset.loadout)}`}
              onClick={() => onLoadoutChange(preset.loadout)}
            >
              {preset.name}
            </button>
          ))}
          <span className="dim">（仅对本地热座生效；联机对局采用房内技能组）</span>
        </div>
        <LoadoutChips loadout={loadout} />
        <div className="actions">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              className="btn"
              disabled={error !== null}
              onClick={() => onPick(count, distribution, String(i), null, null, '')}
            >
              座位 {i + 1}
            </button>
          ))}
          {error && <span className="warn">配比非法，无法开始</span>}
        </div>
        <p className="dim">单窗口完成所有座位的操作，仅用于本地规则调试；联机对局请用下面的房间入口。</p>
      </section>

      <section className="lobby-sec">
        <h2>4 · 联机房间</h2>
        <div className="actions">
          <input
            className="room-input"
            placeholder="房间名称（创建时填写）"
            value={roomTitle}
            maxLength={24}
            onChange={(e) => setRoomTitle(e.target.value)}
          />
          <input
            className="room-input"
            placeholder="房间号，如 K7Q2M9"
            value={room}
            onChange={(e) => setRoom(e.target.value.toUpperCase())}
          />
          <button
            className="btn primary"
            disabled={joining || error !== null || roomName === ''}
            onClick={() => void enterOnline(false)}
          >
            进入房间
          </button>
          <button
            className="btn"
            disabled={joining || error !== null}
            onClick={() => void enterOnline(true)}
          >
            创建房间
          </button>
        </div>
        {(joining || joinError !== null) && (
          <p className={joinError ? 'warn' : 'dim'}>{joinError ?? '正在进入房间…'}</p>
        )}
        <p className="dim notice">
          「创建房间」用房间名称命名，房间号由系统随机生成（不可编辑）；「进入房间」只需输入房间号。房主可在
          牌桌上改房间名，房间名与房间号都可一键复制。进入后自动坐上空位，座位
          坐满则进观战席；房间内点击空座位格子可换座。房间号会写进 URL，分享给其他人即可加入（需相同人数
          与配比；房主为创建房间的玩家）。座位凭据保存在本机浏览器，刷新会自动回到原座位。等待开局时房间没有人在线会进入
          3 分钟留存期：期间任何人进入即重新开局并成为房主，超时房间销毁（房间码失效）；对局进行中则保留到本局结束，
          断线超过 3 分钟由 AI 暂时托管（出牌跳过、技能随机选人），本人回来即恢复。
        </p>
      </section>
    </div>
  );
}
