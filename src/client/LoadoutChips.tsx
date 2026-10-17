import { loadoutEntries, type SkillLoadout } from '../engine';
import { CrystalHex } from './artwork';

/**
 * 技能组明细：把一套技能组展开成「水晶槽 + 技能名」小标签（悬停显示该技能效果），
 * 让玩家看到技能组具体装配了哪些技能，而不只是「初版 / 2025 扩充包」的名字。
 * 槽位号画在小水晶里（与牌桌上的水晶同一套 SVG，见 artwork.tsx）。
 */
export function LoadoutChips({ loadout }: { loadout: SkillLoadout }) {
  return (
    <div className="loadout-chips">
      {loadoutEntries(loadout).map((entry) => (
        <span key={entry.slot} className="chip" title={entry.text || undefined}>
          <span className="chip-hex">
            <CrystalHex placed />
            <b>{entry.slot}</b>
          </span>
          {entry.name}
        </span>
      ))}
    </div>
  );
}

/** 技能组明细的单行文本（用于按钮悬停提示）：如「1 强制出牌 · 2 顺序公开 · …」 */
export function loadoutSummary(loadout: SkillLoadout): string {
  return loadoutEntries(loadout)
    .map((entry) => `${entry.slot} ${entry.name}`)
    .join(' · ');
}
