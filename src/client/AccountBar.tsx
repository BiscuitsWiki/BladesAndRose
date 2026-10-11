/**
 * 大厅顶部的身份条：显示当前玩家身份（游客 / 专属账号）与 UID，
 * 并提供注册、登录、退出登录与复制 UID。注册 / 登录用内联小表单，不做弹窗。
 *
 * 身份条只负责「账号」这一层：座位与对局的接管在 App.tsx / room.ts 里完成。
 */
import { useState } from 'react';
import {
  clearAccount,
  ensureGuestAccount,
  loginAccount,
  registerAccount,
  uidLabel,
  type LocalAccount,
} from './account';
import { loadNickname, saveNickname } from './room';

/** 复制文本：优先 Clipboard API；局域网 http（非安全上下文）下退化为 execCommand */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走退化路径
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** 复制图标（与 App.tsx 同款描边风格，避免跨文件循环依赖而内联一份） */
function CopyIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <rect x="4.8" y="1.6" width="7.6" height="8.8" rx="1.6" />
      <path d="M9.2 10.4v1.2a1.6 1.6 0 0 1-1.6 1.6H2.6A1.6 1.6 0 0 1 1 11.6V6.6a1.6 1.6 0 0 1 1.6-1.6h1.2" />
    </svg>
  );
}

/** 复制成功后的对勾 */
function CheckIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.6 7.4l3 3 5.8-6.4" />
    </svg>
  );
}

export function AccountBar({
  account,
  onAccountChange,
  onResume,
}: {
  account: LocalAccount | null;
  onAccountChange: (account: LocalAccount | null) => void;
  /** 注册 / 登录成功：让上层查一查该 UID 有没有进行中的对局 */
  onResume: (account: LocalAccount) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'register' | 'login'>('idle');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyUid() {
    if (account === null) return;
    if (await copyText(account.uid)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } else {
      setError('复制失败：浏览器未授予剪贴板权限，可手动选中复制');
    }
  }

  function open(next: 'register' | 'login') {
    setMode(next);
    setError(null);
    setPassword('');
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const next =
        mode === 'register'
          ? await registerAccount(username, password)
          : await loginAccount(username, password);
      onAccountChange(next);
      // 昵称为空时默认填用户名（不覆盖已经填过的昵称）
      if (loadNickname() === '' && next.username) saveNickname(next.username);
      setMode('idle');
      setPassword('');
      onResume(next);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    clearAccount();
    setMode('idle');
    setError(null);
    try {
      onAccountChange(await ensureGuestAccount()); // 立刻换回新的游客身份
    } catch {
      onAccountChange(null);
      setError('已退出登录；账号服务器不可用，暂时没有游客身份');
    }
  }

  return (
    <div className="account-bar">
      <span className="uid-chip">
        <span>{account === null ? '未取得玩家身份（账号服务器不可用）' : uidLabel(account)}</span>
        {account !== null && (
          <button
            type="button"
            className={`icon-btn${copied ? ' copied' : ''}`}
            aria-label="复制 UID"
            title="复制 UID"
            onClick={() => void copyUid()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
      </span>
      {account !== null && account.kind === 'guest' && mode === 'idle' && (
        <>
          <button className="btn small" onClick={() => open('register')}>
            注册
          </button>
          <button className="btn small" onClick={() => open('login')}>
            登录
          </button>
          <span className="dim">注册后可用用户名 + 密码在任意设备找回身份与未打完的对局</span>
        </>
      )}
      {account !== null && account.kind === 'account' && mode === 'idle' && (
        <button className="btn small" onClick={() => void logout()}>
          退出登录
        </button>
      )}
      {mode !== 'idle' && (
        <span className="account-form">
          <input
            className="room-input"
            placeholder="用户名（2–16 位中文 / 字母 / 数字 / 下划线）"
            value={username}
            maxLength={16}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="room-input"
            type="password"
            placeholder="密码（6–64 位）"
            value={password}
            maxLength={64}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <button className="btn small primary" disabled={busy} onClick={() => void submit()}>
            {busy ? '处理中…' : mode === 'register' ? '注册' : '登录'}
          </button>
          <button
            className="btn small"
            disabled={busy}
            onClick={() => {
              setMode('idle');
              setError(null);
            }}
          >
            取消
          </button>
        </span>
      )}
      {error !== null && <span className="warn">{error}</span>}
    </div>
  );
}