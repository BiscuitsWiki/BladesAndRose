import { ROLE_ORDER, officialDistribution, type Distribution } from '../engine';

export function isOfficialDistribution(count: number, distribution: Distribution): boolean {
  const official = officialDistribution(count);
  return ROLE_ORDER.every((role) => distribution[role] === official[role]);
}
