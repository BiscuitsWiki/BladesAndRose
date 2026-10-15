/** 复制文本：优先 Clipboard API；局域网 http（非安全上下文）下退化为 execCommand */
export async function copyTextToClipboard(text: string): Promise<boolean> {
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

/** 复制图标（两个重叠的矩形） */
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

/** 编辑（铅笔）图标 */
export function PencilIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="M9.6 2.1l2.3 2.3-7 7-3 .7.7-3z" />
      <path d="M8.3 3.4l2.3 2.3" />
    </svg>
  );
}

/** 格子内右侧的图标按钮：点击复制，成功后短暂变对勾 */
export function CopyButton({
  label,
  copied,
  onCopy,
}: {
  label: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button type="button" className={`icon-btn${copied ? ' copied' : ''}`} aria-label={label} title={label} onClick={onCopy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
