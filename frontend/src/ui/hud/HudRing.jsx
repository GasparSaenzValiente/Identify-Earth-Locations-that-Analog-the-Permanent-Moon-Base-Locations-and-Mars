const TONES = { ice: '#19e3ff', amber: '#ffb347', alert: '#ff4d5e' }

const TICKS = Array.from({ length: 60 }, (_, i) => i)

/**
 * Concentric HUD ring (viewBox −50..50): tick scale, counter-rotating dashed rings and an optional
 * progress arc (0..1). Children are centred inside.
 */
export default function HudRing({ size = 96, progress = null, tone = 'ice', segments = null, spin = true, className = '', children }) {
  const color = TONES[tone] ?? TONES.ice
  return (
    <div className={`hud-ring ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="-50 -50 100 100" width={size} height={size} aria-hidden="true" style={{ filter: `drop-shadow(0 0 3px ${color}88)` }}>
        <g className={spin ? 'hud-spin' : ''}>
          {TICKS.map((i) => {
            const a = (i / 60) * Math.PI * 2
            const long = i % 5 === 0
            const r0 = long ? 44 : 46
            return (
              <line
                key={i}
                x1={Math.cos(a) * r0}
                y1={Math.sin(a) * r0}
                x2={Math.cos(a) * 48.5}
                y2={Math.sin(a) * 48.5}
                stroke={color}
                strokeOpacity={long ? 0.9 : 0.35}
                strokeWidth={long ? 1.2 : 0.7}
              />
            )
          })}
        </g>
        <circle r="41" fill="none" stroke={color} strokeOpacity="0.18" strokeWidth="3" />
        {progress != null && (
          <circle
            r="41"
            fill="none"
            stroke={color}
            strokeWidth="3"
            pathLength="100"
            strokeDasharray={`${Math.max(0, Math.min(1, progress)) * 100} 100`}
            transform="rotate(-90)"
            style={{ transition: 'stroke-dasharray 0.25s linear' }}
          />
        )}
        {segments &&
          segments.map((s, i) => (
            <circle
              key={i}
              r="41"
              fill="none"
              stroke={s.color}
              strokeWidth="3"
              pathLength="100"
              strokeDasharray={`${s.length * 100 - 1} 100`}
              strokeDashoffset={-s.start * 100}
              transform="rotate(-90)"
            />
          ))}
        <g className={spin ? 'hud-spin-rev' : ''}>
          <circle r="35" fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="1.2" strokeDasharray="34 10 4 10" />
        </g>
        <g className={spin ? 'hud-spin' : ''}>
          <circle r="30" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="0.8" strokeDasharray="2 4" />
        </g>
      </svg>
      {children && <div className="hud-ring__center">{children}</div>}
    </div>
  )
}

/** Small spinning reticle used on markers and in-scene targets. */
export function Reticle({ tone = 'ice', className = '', locked = false }) {
  const color = TONES[tone] ?? TONES.ice
  return (
    <svg viewBox="-50 -50 100 100" className={className} aria-hidden="true" style={{ overflow: 'visible', filter: `drop-shadow(0 0 4px ${color})` }}>
      <g className="hud-spin-fast">
        <circle r="40" fill="none" stroke={color} strokeWidth="3" strokeDasharray="38 25" />
      </g>
      <g className="hud-spin-rev">
        <circle r="30" fill="none" stroke={color} strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="6 8" />
      </g>
      {[0, 90, 180, 270].map((a) => (
        <line key={a} x1="0" y1={locked ? -46 : -50} x2="0" y2={locked ? -38 : -44} stroke={color} strokeWidth="3" transform={`rotate(${a})`} />
      ))}
    </svg>
  )
}
