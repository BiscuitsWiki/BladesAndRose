import { describe, expect, it } from 'vitest';
import { hitRateWindow, pruneExpired, type RateWindow } from '../rateLimit';

describe('固定窗口限流（纯函数）', () => {
  it('首次请求开新窗口并放行', () => {
    const decision = hitRateWindow(undefined, 1000, 3, 60_000);
    expect(decision.allowed).toBe(true);
    expect(decision.window).toEqual({ count: 1, resetAt: 61_000 });
  });

  it('窗口内计数递增，达到上限后拒绝', () => {
    let window: RateWindow | undefined;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const decision = hitRateWindow(window, 1000 + i, 3, 60_000);
      window = decision.window;
      results.push(decision.allowed);
    }
    expect(results).toEqual([true, true, true, false]);
    expect(window?.count).toBe(3);
  });

  it('被拒绝时给出剩余等待时间', () => {
    const limit = 1;
    const first = hitRateWindow(undefined, 1000, limit, 60_000);
    const second = hitRateWindow(first.window, 31_000, limit, 60_000);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBe(30_000);
  });

  it('窗口过期后重新计数', () => {
    const first = hitRateWindow(undefined, 1000, 1, 60_000);
    expect(first.allowed).toBe(true);
    const afterExpiry = hitRateWindow(first.window, 61_000, 1, 60_000);
    expect(afterExpiry.allowed).toBe(true);
    expect(afterExpiry.window).toEqual({ count: 1, resetAt: 121_000 });
  });

  it('不改动传入的窗口对象（纯函数）', () => {
    const current: RateWindow = { count: 2, resetAt: 60_000 };
    hitRateWindow(current, 1000, 5, 60_000);
    expect(current).toEqual({ count: 2, resetAt: 60_000 });
  });

  it('清理过期窗口只留未过期的', () => {
    const windows = new Map<string, RateWindow>([
      ['a:1', { count: 1, resetAt: 1000 }],
      ['a:2', { count: 1, resetAt: 6000 }],
      ['a:3', { count: 1, resetAt: 9000 }],
    ]);
    expect(pruneExpired(windows, 5000)).toBe(2);
    expect([...windows.keys()]).toEqual(['a:2', 'a:3']);
  });
});