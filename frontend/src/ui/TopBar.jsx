import { useEffect, useRef } from 'react'
import { useMissionStore } from '../store/useMissionStore'

const LOGO = `${import.meta.env.BASE_URL}brand/space-apps-logo.png`

const STEPS = [
  { key: 'sweep', label: 'SHARAD sweep', phases: ['intro', 'scanning'] },
  { key: 'pick', label: 'Pick a glacier', phases: ['mars'] },
  { key: 'match', label: 'Analog match', phases: ['matching', 'confirm', 'transit', 'returning'] },
  { key: 'earth', label: 'Andean analog', phases: ['earth'] },
]

/** Mission elapsed time since the page opened, written straight to the DOM once a second. */
function MissionClock() {
  const el = useRef(null)
  useEffect(() => {
    const t0 = performance.now()
    const tick = () => {
      const s = Math.floor((performance.now() - t0) / 1000)
      const hh = String(Math.floor(s / 3600)).padStart(2, '0')
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
      const ss = String(s % 60).padStart(2, '0')
      if (el.current) el.current.textContent = `T+${hh}:${mm}:${ss}`
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return <span ref={el} className="tabular-nums" />
}

function Stepper() {
  const phase = useMissionStore((s) => s.phase)
  const activeIndex = STEPS.findIndex((s) => s.phases.includes(phase))
  return (
    <ol className="hidden items-center gap-1.5 md:flex" aria-label="Mission progress">
      {STEPS.map((step, i) => {
        const done = i < activeIndex
        const active = i === activeIndex
        return (
          <li
            key={step.key}
            aria-current={active ? 'step' : undefined}
            title={step.label}
            className={`relative overflow-hidden whitespace-nowrap px-3.5 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors duration-300 [clip-path:polygon(8px_0,100%_0,calc(100%-8px)_100%,0_100%)] ${
              active
                ? 'bg-ice/20 text-white shadow-[inset_0_0_0_1px_rgba(25,227,255,0.8)]'
                : done
                  ? 'bg-ice/[0.07] text-ice-soft/90 shadow-[inset_0_0_0_1px_rgba(25,227,255,0.35)]'
                  : 'bg-white/[0.03] text-white/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]'
            }`}
          >
            {active && <span className="hud-sweep-x absolute inset-y-0 w-10 bg-gradient-to-r from-transparent via-ice/35 to-transparent" />}
            <span className="relative flex items-center gap-2">
              <span className={`font-mono text-[10px] ${active ? 'text-ice' : ''}`}>{done ? '✓' : `0${i + 1}`}</span>
              {/* tablets show the indices only; labels from lg up */}
              <span className="hidden lg:inline">{step.label}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export default function TopBar() {
  const phase = useMissionStore((s) => s.phase)
  const planet = useMissionStore((s) => s.activePlanet)
  const scanning = phase === 'scanning'
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-3 animate-[hud-pop_0.7s_cubic-bezier(0.2,0.9,0.2,1)_both]">
        <img
          src={LOGO}
          alt="NASA Space Apps Challenge"
          className="h-12 w-auto drop-shadow-[0_0_10px_rgba(25,227,255,0.35)] sm:h-14"
          draggable="false"
        />
        <div className="h-12 w-px bg-gradient-to-b from-transparent via-ice/70 to-transparent" />
        <div>
          <div className="font-display text-[15px] font-semibold uppercase tracking-[0.1em] text-white sm:text-[17px]">
            Mars <span className="text-ice">↔</span> Andes <span className="hidden text-white/70 sm:inline">Glacier Analogs</span>
          </div>
          <div className="mt-0.5 font-display text-[13px] font-semibold tracking-[0.06em] text-ice-soft">Rotemos_B(its)</div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <Stepper />
        <div className="hidden items-center gap-4 font-mono text-[10.5px] text-white/70 md:flex">
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${scanning ? 'bg-amber' : 'bg-ice'} hud-blink`} />
            {planet === 'mars' ? 'LINK MRO · SHARAD' : 'LINK GIBS · IANIGLA'}
          </span>
          <span className="text-ice-soft">
            MET <MissionClock />
          </span>
        </div>
      </div>
    </header>
  )
}
