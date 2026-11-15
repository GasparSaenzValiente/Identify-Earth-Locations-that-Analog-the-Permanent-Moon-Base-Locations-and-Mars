/** Small SVG charts in the HUD style: parameter radar and score histogram. */

const TONES = { ice: '#19e3ff', amber: '#ffb347' }

function polygon(values, r) {
  return values
    .map((v, i) => {
      const a = (i / values.length) * Math.PI * 2 - Math.PI / 2
      const k = Math.max(0.02, Math.min(1, v)) * r
      return `${(Math.cos(a) * k).toFixed(2)},${(Math.sin(a) * k).toFixed(2)}`
    })
    .join(' ')
}

/**
 * Radar of per-parameter similarities (0..1). `series` = [{ values, tone, dashed }], the first one
 * is drawn on top. Axis labels sit outside the outer ring.
 */
export function RadarChart({ axes, series, size = 190, animateKey }) {
  const r = 70
  return (
    <svg viewBox="-100 -96 200 192" width={size} height={(size * 192) / 200} aria-hidden="true" className="overflow-visible">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={polygon(axes.map(() => k), r)} fill="none" stroke="#19e3ff" strokeOpacity={k === 1 ? 0.45 : 0.15} strokeWidth="0.8" />
      ))}
      {axes.map((ax, i) => {
        const a = (i / axes.length) * Math.PI * 2 - Math.PI / 2
        const x = Math.cos(a)
        const y = Math.sin(a)
        return (
          <g key={ax.key}>
            <line x1="0" y1="0" x2={x * r} y2={y * r} stroke="#19e3ff" strokeOpacity="0.22" strokeWidth="0.8" />
            <text
              x={x * (r + 14)}
              y={y * (r + 14) + 3}
              textAnchor={Math.abs(x) < 0.2 ? 'middle' : x > 0 ? 'start' : 'end'}
              className="fill-white/75 font-mono"
              style={{ fontSize: 9 }}
            >
              {ax.label}
            </text>
          </g>
        )
      })}
      {[...series].reverse().map((s, i) => (
        <polygon
          key={`${animateKey}-${i}`}
          className="hud-radar-poly"
          points={polygon(s.values, r)}
          fill={TONES[s.tone]}
          fillOpacity={s.dashed ? 0.04 : 0.18}
          stroke={TONES[s.tone]}
          strokeWidth={s.dashed ? 1 : 1.6}
          strokeDasharray={s.dashed ? '3 3' : undefined}
          style={{ filter: s.dashed ? undefined : `drop-shadow(0 0 4px ${TONES[s.tone]})` }}
        />
      ))}
      {series[0] &&
        series[0].values.map((v, i) => {
          const a = (i / series[0].values.length) * Math.PI * 2 - Math.PI / 2
          const k = Math.max(0.02, Math.min(1, v)) * r
          return <circle key={i} cx={Math.cos(a) * k} cy={Math.sin(a) * k} r="2.4" fill={TONES[series[0].tone]} />
        })}
    </svg>
  )
}

/** Histogram of a 0–100 score (bins precomputed), with markers for a value and the mean. */
export function ScoreHistogram({ bins, marker, mean, tone = 'ice', height = 54 }) {
  const max = Math.max(1, ...bins)
  const w = 100 / bins.length
  const markerBin = marker == null ? -1 : Math.min(bins.length - 1, Math.floor((marker / 100) * bins.length))
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-[54px] w-full" aria-hidden="true">
      {bins.map((b, i) => {
        const h = b ? Math.max(1.5, ((height - 4) * Math.sqrt(b)) / Math.sqrt(max)) : 0
        return (
          <rect
            key={i}
            x={i * w + 0.4}
            y={height - h}
            width={w - 0.8}
            height={h}
            fill={i === markerBin ? TONES.amber : TONES[tone]}
            fillOpacity={i === markerBin ? 0.95 : 0.45}
            className="hud-hist-bar"
            style={{ animationDelay: `${i * 25}ms` }}
          />
        )
      })}
      {mean != null && <line x1={mean} x2={mean} y1="0" y2={height} stroke="#ffffff" strokeOpacity="0.55" strokeWidth="0.5" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />}
      {marker != null && <line x1={marker} x2={marker} y1="0" y2={height} stroke={TONES.amber} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

/**
 * Where a log distance falls relative to the pipeline's P5–P95 tolerance band: similarity is 1
 * left of the band and 0 right of it.
 */
export function BandGauge({ distance, lo, hi, tone = 'amber' }) {
  const span = hi - lo
  const min = Math.max(0, lo - span * 0.6)
  const max = hi + span * 0.6
  const x = (v) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-2.5 w-full" aria-hidden="true">
      <rect x="0" y="3.5" width={x(lo)} height="3" fill="#19e3ff" fillOpacity="0.5" />
      <rect x={x(lo)} y="3.5" width={x(hi) - x(lo)} height="3" fill="url(#band-grad)" />
      <rect x={x(hi)} y="3.5" width={100 - x(hi)} height="3" fill="#ff4d5e" fillOpacity="0.35" />
      <defs>
        <linearGradient id="band-grad" x1="0" x2="1">
          <stop offset="0" stopColor="#19e3ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ff4d5e" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <rect x={x(distance) - 0.9} y="0" width="1.8" height="10" fill={TONES[tone]} />
    </svg>
  )
}
