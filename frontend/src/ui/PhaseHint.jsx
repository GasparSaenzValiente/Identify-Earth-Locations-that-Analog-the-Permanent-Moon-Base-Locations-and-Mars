import { useMissionStore } from '../store/useMissionStore'
import { IS_TOUCH } from '../three/mars/GlacierMarkers'

function Bar({ children, tone = 'ice', action }) {
  const color = tone === 'amber' ? 'text-amber' : 'text-ice'
  return (
    <div className="flex max-w-[94vw] items-center gap-3 bg-[linear-gradient(90deg,rgba(2,12,20,0.85),rgba(4,22,32,0.85),rgba(2,12,20,0.85))] px-5 py-2.5 text-[14px] font-medium text-white/90 shadow-[inset_0_0_0_1px_rgba(25,227,255,0.35)] backdrop-blur-md [clip-path:polygon(12px_0,calc(100%-12px)_0,100%_50%,calc(100%-12px)_100%,12px_100%,0_50%)] animate-[hud-pop_0.5s_cubic-bezier(0.2,0.9,0.2,1)_both]">
      <span className={`font-display text-[12px] font-bold tracking-[-0.1em] ${color}`} aria-hidden="true">
        <span className="hud-blink">▸</span>▸▸
      </span>
      <span>{children}</span>
      {action}
    </div>
  )
}

/** Contextual instruction strip at the bottom of the screen, one per phase. */
export function PhaseHint() {
  const phase = useMissionStore((s) => s.phase)
  const status = useMissionStore((s) => s.glf.status)
  const count = useMissionStore((s) => s.glf.items.length)
  const activateSharad = useMissionStore((s) => s.activateSharad)
  const andesCount = useMissionStore((s) => s.andes.data?.glaciers.length ?? 0)

  let content = null
  if (phase === 'intro') {
    content = (
      <Bar
        action={
          <button type="button" className="hud-btn pointer-events-auto ml-1 !px-3 !py-1.5 !text-[10.5px]" onClick={activateSharad}>
            Run sweep
          </button>
        }
      >
        Select the <b className="text-ice">SHARAD</b> orbiter to sweep Mars for glacier-like forms
      </Bar>
    )
  } else if (phase === 'scanning') {
    content = <Bar>{status === 'loading' ? 'Loading the Souness et al. (2012) inventory' : 'SHARAD radar sweep in progress'}</Bar>
  } else if (phase === 'mars') {
    content = (
      <Bar>
        {count.toLocaleString()} glacier-like forms · <b className="text-ice">{IS_TOUCH ? 'tap' : 'hover'}</b> to inspect ·{' '}
        <b className="text-ice">{IS_TOUCH ? 'tap again' : 'click'}</b> to target
      </Bar>
    )
  } else if (phase === 'earth' && andesCount) {
    content = (
      <Bar tone="amber">
        {andesCount.toLocaleString()} Andean glaciers ranked · <b className="text-amber">{IS_TOUCH ? 'tap' : 'hover'}</b> to inspect ·{' '}
        <b className="text-amber">{IS_TOUCH ? 'tap again' : 'click'}</b> to compare
      </Bar>
    )
  } else if (phase === 'returning') {
    content = <Bar tone="amber">Returning to Mars</Bar>
  }
  if (!content) return null
  return (
    // On phones the Earth comparison is a bottom sheet: the hint would sit on top of it.
    <div key={phase} className={`pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4 sm:bottom-8 ${phase === 'earth' ? 'max-sm:hidden' : ''}`}>
      {content}
    </div>
  )
}
