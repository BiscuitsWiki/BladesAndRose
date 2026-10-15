import {
  ROLE_LABEL,
  ROLE_ORDER,
  WIN_THRESHOLDS,
  officialDistribution,
  validateDistribution,
  type Distribution,
} from '../../engine';

export function DistributionEditor({
  count,
  value,
  onChange,
}: {
  count: number;
  value: Distribution;
  onChange: (next: Distribution) => void;
}) {
  const official = officialDistribution(count);
  const total = ROLE_ORDER.reduce((sum, role) => sum + value[role], 0);
  const error = validateDistribution(value, count);

  return (
    <div className="dist">
      <table>
        <tbody>
          {ROLE_ORDER.map((role) => {
            // 白蔷薇与暗刃必须有且只能有 1 名，配比界面固定不可调
            const fixed = role === 'whiteRose' || role === 'darkBlade';
            return (
              <tr key={role}>
                <td className="role-name">{ROLE_LABEL[role]}</td>
                <td className="dim">{fixed ? '固定 1' : `官方 ${official[role]}`}</td>
                <td className="stepper">
                  <button
                    className="btn small"
                    disabled={fixed}
                    onClick={() => onChange({ ...value, [role]: Math.max(0, value[role] - 1) })}
                  >
                    −
                  </button>
                  <span className="count">{value[role]}</span>
                  <button
                    className="btn small"
                    disabled={fixed}
                    onClick={() => onChange({ ...value, [role]: value[role] + 1 })}
                  >
                    ＋
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={error ? 'warn' : 'dim'}>
        合计 {total} / {count}
        {error ? ` —— ${error}` : ''}
      </p>
      <p className="dim">
        阈值仍按人数取官方值：献祭 {WIN_THRESHOLDS[count].sacrifice} · 死亡{' '}
        {WIN_THRESHOLDS[count].death}
      </p>
      <button className="btn small" onClick={() => onChange(official)}>
        恢复官方配比
      </button>
    </div>
  );
}
