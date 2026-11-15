import { useEffect, useRef } from 'react'
import { formatLat, formatLon } from '../lib/geo'
import { viewState } from '../three/sharedState'

const CORNERS = [
  { cls: 'left-3 top-3', d: 'M2,16 V2 H16' },
  { cls: 'right-3 top-3', d: 'M18,2 H32 V16' },
  { cls: 'right-3 bottom-3', d: 'M32,18 V32 H18' },
  { cls: 'left-3 bottom-3', d: 'M16,32 H2 V18' },
]

function Ruler({ side }) {
  const ticks = Array.from({ length: 31 }, (_, i) => i)
  return (
    <svg
      className={`absolute top-1/2 hidden h-[248px] w-[18px] -translate-y-1/2 lg:block ${side === 'left' ? 'left-3' : 'right-3 -scale-x-100'}`}
      viewBox="0 0 18 248"
      aria-hidden="true"
    >
      {ticks.map((i) => (
        <line key={i} x1="0" y1={4 + i * 8} x2={i % 5 === 0 ? 12 : 6} y2={4 + i * 8} stroke="#19e3ff" strokeOpacity={i % 5 === 0 ? 0.55 : 0.25} />
      ))}
      <path d="M14,0 l4,4 l-4,4 Z" fill="#19e3ff" className="hud-ruler-cursor" />
    </svg>
  )
}

/** Live sub-camera coordinates + altitude over the planet in view. */
function Telemetry() {
  const planet = useRef(null)
  const coords = useRef(null)
  const alt = useRef(null)
  useEffect(() => {
    const id = setInterval(() => {
      if (planet.current) planet.current.textContent = viewState.planet.toUpperCase()
      if (coords.current) coords.current.textContent = `${formatLat(viewState.lat)}  ${formatLon(viewState.lon)}`
      if (alt.current) alt.current.textContent = `${Math.max(0, Math.round(viewState.altitudeKm)).toLocaleString('en-US')} km`
    }, 120)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="absolute bottom-5 left-6 hidden font-mono text-[10.5px] leading-[1.5] text-white/75 lg:block">
      <div className="flex items-center gap-2">
        <span className="text-ice">▸</span>
        <span ref={planet} className="font-display font-semibold tracking-[0.2em] text-ice-soft">MARS</span>
        <span ref={coords} />
      </div>
      <div className="pl-4">
        ALT <span ref={alt} className="text-white" />
      </div>
    </div>
  )
}

/** Screen-level HUD dressing: corner brackets, edge rulers, grid, scanlines, sweep, telemetry. */
export default function HudChrome() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="hud-grid absolute inset-0" />
      <div className="hud-scanlines absolute inset-0 opacity-60" />
      <div className="absolute inset-0 overflow-hidden">
        <div className="hud-sweep absolute inset-x-0 h-full" />
      </div>
      {CORNERS.map((c) => (
        <svg key={c.cls} className={`absolute h-[34px] w-[34px] ${c.cls}`} viewBox="0 0 34 34" style={{ filter: 'drop-shadow(0 0 4px #19e3ff)' }}>
          <path d={c.d} fill="none" stroke="#19e3ff" strokeOpacity="0.8" strokeWidth="2" />
        </svg>
      ))}
      <Ruler side="left" />
      <Ruler side="right" />
      <Telemetry />
    </div>
  )
}
