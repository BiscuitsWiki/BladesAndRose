import { ROLE_ORDER, officialDistribution, type Distribution } from '../engine';

/** 可选玩家人数（5–10 人） */
export const PLAYER_COUNTS = [5, 6, 7, 8, 9, 10];

export function isOfficialDistribution(count: number, distribution: Distribution): boolean {
  const official = officialDistribution(count);
  return ROLE_ORDER.every((role) => distribution[role] === official[role]);
}
