import { useEffect, useRef, useState } from 'react'
import { MEAN_EARTH_MARS_DISTANCE_KM, SPEED_OF_LIGHT_KMS } from '../config/scene'
import { flightState } from '../three/sharedState'
import { useMissionStore } from '../store/useMissionStore'
import HudPanel from './hud/HudPanel'
import HudRing from './hud/HudRing'
import { SegmentBar } from './hud/primitives'

/** Interplanetary transit read-out. Polls flightState (no per-frame React work beyond ~12 Hz). */
export default function TransitOverlay() {
  const phase = useMissionStore((s) => s.phase)
  const analog = useMissionStore((s) => s.selectedAnalog)
  const visible = phase === 'transit' || phase === 'returning'
  const toEarth = phase === 'transit'
  const [p, setP] = useState(0)
  const distance = useRef(null)
  const light = useRef(null)

  useEffect(() => {
    if (!visible) return undefined
    setP(0)
    const id = setInterval(() => {
      const prog = flightState.progress
      setP(prog)
      const remaining = MEAN_EARTH_MARS_DISTANCE_KM * (1 - prog)
      if (distance.current) distance.current.textContent = `${(remaining / 1e6).toFixed(2)} M km`
      if (light.current) light.current.textContent = `${(remaining / SPEED_OF_LIGHT_KMS / 60).toFixed(1)} light-min`
    }, 80)
    return () => clearInterval(id)
  }, [visible])

  if (!visible) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center px-4 sm:top-28">
      <HudPanel cut={14} className="w-[min(540px,94vw)]" contentClassName="flex items-center gap-4 px-5 py-4">
        <HudRing size={76} progress={p} tone={toEarth ? 'ice' : 'amber'}>
          <span className="font-display text-[13px] font-bold tabular-nums text-white">{Math.round(p * 100)}%</span>
        </HudRing>
        <div className="min-w-0 flex-1">
          <div className="hud-label">{toEarth ? 'In transit · Mars → Earth' : 'In transit · Earth → Mars'}</div>
          <div className="mt-2 flex items-center gap-2 font-display text-[12px] font-semibold uppercase tracking-[0.14em]">
            <span className={toEarth ? 'text-mars' : 'text-earth'}>{toEarth ? 'Mars' : 'Earth'}</span>
            <SegmentBar className="flex-1" value={p} segments={30} stagger={0} />
            <span className={toEarth ? 'text-earth' : 'text-mars'}>{toEarth ? 'Earth' : 'Mars'}</span>
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-white/80">
            <span>
              RANGE <span ref={distance} className="text-white">—</span>
            </span>
            <span ref={light}>—</span>
          </div>
          {toEarth && analog && (
            <div className="mt-1 truncate font-mono text-[10.5px] text-white/70">
              DEST <span className="text-amber">{analog.analog.name}</span> · {analog.analog.code} · {analog.score.toFixed(1)}%
            </div>
          )}
        </div>
      </HudPanel>
    </div>
  )
}
