/**
 * 按 IP 的固定窗口限流（进程内实现，单实例部署够用；将来多实例需要换成 Redis）。
 *
 * 只放纯逻辑：状态推进与判定都在这里，便于单测；HTTP 层（取客户端 IP、回 429）在 dev-server.ts。
 *
 * 用途：公网暴露后挡住「刷接口」——例如无限发游客号（会让账号表膨胀）、无限建房（占内存）。
 * 正常玩家远达不到阈值（一局房间面板每 3 秒轮询一次 ≈ 20 次/分/标签页），因此阈值给得宽松。
 */

/** 一个（scope + IP）的固定窗口状态 */
export interface RateWindow {
  /** 当前窗口内已计数的请求数 */
  count: number;
  /** 当前窗口的结束时刻（epoch ms） */
  resetAt: number;
}

export interface RateDecision {
  allowed: boolean;
  /** 推进后的窗口状态（调用方写回存储） */
  window: RateWindow;
  /** 被拒绝时距离可重试还有多少毫秒（用于 Retry-After） */
  retryAfterMs: number;
}

/**
 * 命中一次限流窗口（纯函数，不改动入参）：
 *   - 没有窗口 / 窗口已过期 → 开一个新窗口并放行；
 *   - 窗口内计数未达上限 → 计数 +1 并放行；
 *   - 已达上限 → 拒绝，并给出该窗口剩余时间。
 */
export function hitRateWindow(
  current: RateWindow | undefined,
  now: number,
  limit: number,
  windowMs: number,
): RateDecision {
  if (current === undefined || now >= current.resetAt) {
    return { allowed: true, window: { count: 1, resetAt: now + windowMs }, retryAfterMs: 0 };
  }
  if (current.count >= limit) {
    return { allowed: false, window: current, retryAfterMs: Math.max(0, current.resetAt - now) };
  }
  return {
    allowed: true,
    window: { count: current.count + 1, resetAt: current.resetAt },
    retryAfterMs: 0,
  };
}

/**
 * 清理已过期的窗口（避免长期运行后状态表无限增长）。
 * 返回保留下来的条目数；仅在表较大时由调用方触发，正常规模下几乎不执行。
 */
export function pruneExpired(windows: Map<string, RateWindow>, now: number): number {
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
  return windows.size;
}