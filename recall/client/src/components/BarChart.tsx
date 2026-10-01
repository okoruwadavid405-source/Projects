export interface Bar {
  key: string;
  label: string;
  value: number;
  title: string;
  highlight?: boolean;
}

/** A small accessible bar chart: the visual is hidden from screen readers, which get a table instead. */
export function BarChart({
  bars,
  caption,
  compact,
  showValues = true,
  axis,
}: {
  bars: Bar[];
  caption: string;
  compact?: boolean;
  showValues?: boolean;
  /** Start/end labels under the chart, for dense charts whose bars are too narrow to label. */
  axis?: [string, string];
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <figure style={{ margin: 0 }}>
      <div className={`bars ${compact ? 'compact' : ''}`} aria-hidden>
        {bars.map((b) => (
          <div className="bar-col" key={b.key} title={b.title}>
            {showValues && <span className="bar-value">{b.value > 0 ? b.value : ''}</span>}
            <div className="bar-track">
              <div className={`bar ${b.value === 0 ? 'zero' : ''} ${b.highlight ? 'highlight' : ''}`} style={{ height: `${(b.value / max) * 100}%` }} />
            </div>
            {!axis && <span className="bar-label">{b.label}</span>}
          </div>
        ))}
      </div>
      {axis && (
        <div className="chart-axis" aria-hidden>
          <span>{axis[0]}</span>
          <span>{axis[1]}</span>
        </div>
      )}
      {/* Tables ignore the 1px width trick, so the wrapper is what gets visually hidden. */}
      <div className="visually-hidden">
        <table>
        <caption>{caption}</caption>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.title}</th>
              <td>{b.value}</td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
