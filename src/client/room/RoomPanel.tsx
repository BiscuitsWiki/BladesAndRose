import { useState } from 'react';
import { LOADOUT_PRESETS } from '../../engine';
import { avatarColor } from '../avatar';
import { LoadoutChips, loadoutSummary } from '../LoadoutChips';
import { type RoomInfo } from '../room';

/** 房间面板：座位格子（空位点击入座 / 换座）、观战席、房主的「开始游戏」与「转移房主」 */
export function RoomPanel({
  count,
  mySeat,
  info,
  error,
  started,
  isHost,
  transferMode,
  busy,
  onStart,
  onToggleTransfer,
  onTransferHost,
  onTakeSeat,
  onSetSkills,
}: {
  count: number;
  mySeat: string | null;
  info: RoomInfo;
  error: string | null;
  started: boolean;
  isHost: boolean;
  transferMode: boolean;
  /** 换座 / 入座请求进行中：格子先禁用，避免重复点击 */
  busy: boolean;
  onStart: () => void;
  onToggleTransfer: () => void;
  onTransferHost: (seat: string) => void;
  onTakeSeat: (seat: string) => void;
  /** 房主保存技能组（presetId 为预设标识，如 base / 2025）；保存前已由弹窗确认 */
  onSetSkills: (presetId: string) => void;
}) {
  const taken = Object.keys(info.seats).length;
  const hostLabel = info.hostSeat !== null ? `座位 ${Number(info.hostSeat) + 1}` : null;
  /** 房内技能组对应的预设（命中时用于展示明细；未命中预设则无从得知槽位，不展示） */
  const roomLoadout = LOADOUT_PRESETS.find((preset) => preset.id === info.skillset?.id)?.loadout ?? null;
  /** 技能组修改：本地选中的预设；confirmSkill = 待二次确认的预设 id */
  const [skillPick, setSkillPick] = useState<string | null>(null);
  const [confirmSkill, setConfirmSkill] = useState<string | null>(null);
  /** 房主选中但尚未保存的预设（用于预览明细） */
  const pickedPreset = LOADOUT_PRESETS.find((preset) => preset.id === skillPick) ?? null;
  return (
    <div className="panel">
      <h2>
        座位（{taken} / {count} 已入座）
      </h2>
      <div className="seat-grid">
        {Array.from({ length: count }, (_, i) => {
          const id = String(i);
          const occupant = info.seats[id];
          const mine = mySeat === id;
          /** AI 托管中的座位：对局中断线超过 3 分钟，服务器代为操作（出牌跳过、技能随机选人） */
          const ai = info.ai.includes(id);
          /** 断线中的座位（含被托管的）：面板上变灰 */
          const offline = info.offline.includes(id) || ai;
          // 转移房主模式：只有「已入座且不是自己」的座位可点
          const selectable = transferMode ? Boolean(occupant) && !mine : !occupant && !started;
          const title = offline
            ? ai
              ? `${occupant} 断线中，暂由 AI 托管（出牌跳过、技能随机选人）；本人回来后自动恢复`
              : started
                ? `${occupant} 断线中：座位保留到本局结束，超过 3 分钟将由 AI 暂时托管`
                : `${occupant} 断线中：1 分钟内未重连将视为退出房间`
            : transferMode
              ? selectable
                ? `把房主转给 ${occupant}`
                : mine
                  ? '不能把房主转给自己'
                  : '这个座位空着'
              : occupant
                ? `${occupant} 在这个座位`
                : started
                  ? '已开局，不能再换座'
                  : '点击入座';
          return (
            <button
              key={id}
              className={`seat-card${occupant ? ' taken' : ''}${mine ? ' mine' : ''}${
                offline ? ' offline' : ''
              }${ai ? ' ai' : ''}${transferMode && selectable ? ' selectable' : ''}`}
              disabled={!selectable || busy}
              title={title}
              onClick={() => (transferMode ? onTransferHost(id) : onTakeSeat(id))}
            >
              <span
                className="avatar"
                style={occupant ? { background: avatarColor(occupant) } : undefined}
              >
                {occupant ? occupant.slice(0, 1) : '＋'}
              </span>
              <span className="seat-name">
                {occupant ?? '空座位'}
                {mine ? '（你）' : ''}
              </span>
              <span className="seat-no">
                座位 {i + 1}
                {id === info.hostSeat ? ' · 房主' : ''}
                {ai ? ' · AI 托管' : offline ? ' · 断线中' : ''}
              </span>
            </button>
          );
        })}
      </div>
      {busy && <p className="dim">正在切换座位…</p>}
      <p className="dim">
        观战席（{info.spectators.length}）
        {info.spectators.length > 0 ? `：${info.spectators.join('、')}` : '：暂无观战者'}
      </p>
      <p className="dim">
        技能组：<strong>{info.skillset?.name ?? '初版'}</strong>
        {isHost && !started ? '（房主可修改；所有玩家无需刷新，牌桌会实时同步）' : ''}
      </p>
      {roomLoadout && <LoadoutChips loadout={roomLoadout} />}
      {isHost && !started && (
        <div className="actions">
          <span className="dim">改为：</span>
          {LOADOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={`btn small${skillPick === preset.id ? ' primary' : ''}`}
              title={`${preset.name}技能表：${loadoutSummary(preset.loadout)}`}
              onClick={() => setSkillPick(preset.id)}
            >
              {preset.name}
            </button>
          ))}
          <button
            className="btn small"
            disabled={skillPick === null || skillPick === (info.skillset?.id ?? null)}
            onClick={() => setConfirmSkill(skillPick)}
          >
            保存技能组
          </button>
        </div>
      )}
      {isHost && !started && pickedPreset && (
        <div className="loadout-preview">
          <span className="dim">待保存的「{pickedPreset.name}」：</span>
          <LoadoutChips loadout={pickedPreset.loadout} />
        </div>
      )}
      {confirmSkill !== null && (
        <div className="modal-mask" onClick={() => setConfirmSkill(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <p>修改技能组只影响尚未开始的对局；所有玩家无需刷新，牌桌会实时同步。</p>
            <div className="actions">
              <button
                className="btn primary"
                onClick={() => {
                  const presetId = confirmSkill;
                  setConfirmSkill(null);
                  onSetSkills(presetId);
                }}
              >
                确认修改
              </button>
              <button className="btn" onClick={() => setConfirmSkill(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      {transferMode && (
        <p className="dim">点一个已入座的玩家，把房主转给他；再点「取消转移」即可退出。</p>
      )}
      {isHost && (
        <div className="actions">
          {!started && (
            <button className="btn primary" disabled={taken < count} onClick={onStart}>
              开始游戏
            </button>
          )}
          <button className="btn small" onClick={onToggleTransfer}>
            {transferMode ? '取消转移' : '转移房主'}
          </button>
          {!started && (
            <span className="dim">
              {taken < count
                ? `还有 ${count - taken} 个空座位：坐满后才能开始（人凑不齐可回大厅改人数后重开房间）`
                : '全员已就座，点击开始'}
            </span>
          )}
        </div>
      )}
      {!started && !isHost && (
        <p className="dim">等待房主{hostLabel !== null ? `（${hostLabel}）` : ''}点击「开始游戏」…</p>
      )}
      {error !== null && <p className="warn">{error}</p>}
    </div>
  );
}
