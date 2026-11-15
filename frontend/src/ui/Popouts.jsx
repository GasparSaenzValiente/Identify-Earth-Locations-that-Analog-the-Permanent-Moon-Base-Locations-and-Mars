import { useEffect, useRef, useState } from 'react'
import { MEAN_EARTH_MARS_DISTANCE_KM, SPEED_OF_LIGHT_KMS } from '../config/scene'
import { compareGlacier, pct } from '../lib/analogScoring'
import { formatLatLon } from '../lib/geo'
import { marsSiteProfile } from '../lib/marsEnvironment'
import { siteElevation } from '../services/analogMatchingService'
import { useMissionStore } from '../store/useMissionStore'
import HudPanel from './hud/HudPanel'
import HudRing from './hud/HudRing'
import { CountUp, SegmentBar, Typewriter, usePresence } from './hud/primitives'

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—')

/** Fires `true` for `ms` after the phase goes from `from` to `to`. */
function usePhaseFlash(from, to, ms) {
  const phase = useMissionStore((s) => s.phase)
  const prev = useRef(phase)
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (prev.current === from && phase === to) setOn(true)
    else if (phase !== to) setOn(false)
    prev.current = phase
  }, [phase, from, to])
  useEffect(() => {
    if (!on) return undefined
    const id = setTimeout(() => setOn(false), ms)
    return () => clearTimeout(id)
  }, [on, ms])
  return on
}

/* ── Sweep complete ─────────────────────────────────────────────────────────────────────────── */
export function ScanCompletePopout() {
  const glf = useMissionStore((s) => s.glf)
  const show = usePhaseFlash('scanning', 'mars', 5200)
  const { mounted, leaving } = usePresence(show)
  if (!mounted || glf.status !== 'ready') return null
  const total = glf.items.length
  const north = glf.items.filter((g) => g.lat >= 0).length
  return (
    <div
      // below md the Mars panel starts collapsed, so the read-out sits above the hint strip; from md
      // it goes to the top-right column, clear of the open panel
      className={`pointer-events-none absolute inset-x-0 bottom-24 flex justify-center px-4 md:inset-x-auto md:bottom-auto md:right-6 md:top-28 md:px-0 ${leaving ? 'hud-leaving' : ''}`}
    >
      <HudPanel cut={14} contentClassName="flex items-center gap-4 px-5 py-4">
        <HudRing
          size={84}
          segments={[
            { start: 0, length: north / total, color: '#19e3ff' },
            { start: north / total, length: (total - north) / total, color: '#ffb347' },
          ]}
        >
          <span className="font-display text-[11px] font-bold tracking-[0.15em] text-ice">N/S</span>
        </HudRing>
        <div className="min-w-[230px]">
          <div className="hud-label">Sweep complete</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold tabular-nums text-white">
              <CountUp value={total} />
            </span>
            <span className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">glacier-like forms</span>
          </div>
          <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-white/80">
            <span className="text-ice">N</span>
            <SegmentBar value={north / total} segments={18} />
            <span>{north}</span>
            <span className="text-amber">S</span>
            <SegmentBar value={(total - north) / total} segments={18} tone="amber" />
            <span>{total - north}</span>
          </div>
          <div className="mt-2 font-mono text-[10.5px] text-white/65">{glf.regions.length} named regions · 30–60° latitude bands</div>
        </div>
      </HudPanel>
    </div>
  )
}

/* ── Analog search (camera framing the target) ──────────────────────────────────────────────── */
export function AnalysisPopout() {
  const phase = useMissionStore((s) => s.phase)
  const site = useMissionStore((s) => s.selectedMarsSite)
  const match = useMissionStore((s) => s.selectedAnalog)
  const cancel = useMissionStore((s) => s.cancelTravel)
  const andes = useMissionStore((s) => s.andes)
  const glfItems = useMissionStore((s) => s.glf.items)
  const { mounted, leaving } = usePresence(phase === 'matching' && !!site)
  const last = useRef(site)
  if (site) last.current = site
  const s = last.current
  if (!mounted || !s) return null
  const isGlf = s.kind === 'glf'
  const env = andes.data ? marsSiteProfile({ lat: s.lat, ...siteElevation(s, glfItems) }, andes.data.reference).values : null
  const pool = andes.data ? `${andes.data.glaciers.length.toLocaleString('en-US')} Andean glaciers · ${andes.data.cells.length} climate cells` : 'Andean glacier inventory'
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4 sm:bottom-8 ${leaving ? 'hud-leaving' : ''}`}
      inert={leaving || undefined}
    >
      <HudPanel cut={16} className="pointer-events-auto w-[min(520px,94vw)]" contentClassName="flex items-center gap-4 px-5 py-4">
        <HudRing size={78}>
          <span className="font-display text-[10px] font-bold tracking-[0.2em] text-ice hud-blink">SCAN</span>
        </HudRing>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="hud-label">Analog search</div>
            <button type="button" className="hud-btn hud-btn--danger !px-3 !py-1 !text-[10px]" onClick={cancel}>
              Abort
            </button>
          </div>
          <div className="mt-1.5 space-y-0.5 font-mono text-[11px] text-white/85">
            <div className="truncate">
              <span className="text-ice">TARGET&nbsp;&nbsp;</span>
              <Typewriter text={`${s.name}${isGlf ? ` · GLF-${s.number}` : ''}`} />
            </div>
            {isGlf && (
              <div className="truncate">
                <span className="text-ice">PROFILE&nbsp;</span>
                <Typewriter text={`L ${fmt(s.lengthKm)} km · W ${fmt(s.widthKm)} km · z̄ ${fmt(s.elevation?.mean, 0)} m`} delay={350} speed={12} />
              </div>
            )}
            {env && (
              <div className="truncate">
                <span className="text-ice">ENV&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                <Typewriter
                  text={`P ${Math.round(env.p_superficie)} Pa · T ${env.t_superficie.toFixed(0)} K · ρ ${env.rho_aire.toFixed(3)} · S ${env.solar.toFixed(0)} W/m²`}
                  delay={550}
                  speed={10}
                />
              </div>
            )}
            <div className="truncate">
              <span className="text-ice">SEARCH&nbsp;&nbsp;</span>
              <Typewriter text={pool} delay={800} speed={12} />
            </div>
            {match && (
              <div className="truncate">
                <span className="text-amber">MATCH&nbsp;&nbsp;&nbsp;</span>
                <Typewriter text={`${match.analog.name} · ${match.score.toFixed(1)}%`} speed={18} className="text-amber" />
              </div>
            )}
          </div>
          <SegmentBar className="mt-2.5" value={match ? 1 : 0.62} segments={28} stagger={22} />
        </div>
      </HudPanel>
    </div>
  )
}

/** Per-stage similarity of the chosen analog (E1 surface, E3 atmosphere, E4 forcing). */
function ConditionBars({ match }) {
  const data = useMissionStore((s) => s.andes.data)
  if (!data) return null
  const cmp = compareGlacier(data, match.scorings.site, match.analogIndex)
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-white/85">
      {cmp.stages.map((s) => (
        <span key={s.key} className="contents">
          <span className="text-amber">
            {s.key} <span className="text-white/70">{s.label}</span>
          </span>
          <SegmentBar value={s.sim} segments={14} tone="amber" />
          <span>{(s.sim * 100).toFixed(0)}%</span>
        </span>
      ))}
    </div>
  )
}

/** Next-best glaciers for this site (the ranking continues on Earth). */
function RunnerUps({ match }) {
  const data = useMissionStore((s) => s.andes.data)
  if (!data) return null
  const sc = match.scorings.site
  const picks = []
  const seen = new Set([match.analog.sector.name])
  for (const i of sc.order) {
    const g = data.glaciers[i]
    if (seen.has(g.sector.name)) continue
    seen.add(g.sector.name)
    picks.push(i)
    if (picks.length === 2) break
  }
  return (
    <div className="space-y-0.5 font-mono text-[10.5px]">
      {picks.map((i, k) => (
        <div key={i} className="flex items-center gap-2 text-white/75">
          <span className="text-white/45">#{(sc.rank[i] + 1).toLocaleString('en-US')}</span>
          <span className="flex-1 truncate">{data.glaciers[i].name}</span>
          <span className={k === 0 ? 'text-amber/90' : 'text-amber/70'}>{pct(sc.score[i])}</span>
        </div>
      ))}
      <div className="text-white/50">{data.glaciers.length.toLocaleString('en-US')} glaciers ranked</div>
    </div>
  )
}

/* ── Flight confirmation ────────────────────────────────────────────────────────────────────── */
export function ConfirmPopout() {
  const phase = useMissionStore((s) => s.phase)
  const site = useMissionStore((s) => s.selectedMarsSite)
  const match = useMissionStore((s) => s.selectedAnalog)
  const confirm = useMissionStore((s) => s.confirmTravel)
  const cancel = useMissionStore((s) => s.cancelTravel)
  const launch = useRef(null)
  const dialog = useRef(null)
  const visible = phase === 'confirm' && !!site && !!match

  useEffect(() => {
    if (!visible) return undefined
    // Focus Launch once the entrance settles — unless the user already moved focus into the dialog.
    const t = setTimeout(() => {
      if (!dialog.current?.contains(document.activeElement)) launch.current?.focus({ preventScroll: true })
    }, 450)
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key === 'Escape') cancel()
      // a focused button handles Enter itself (native click), so it never does the opposite action
      if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') confirm()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [visible, confirm, cancel])

  if (!visible) return null
  const { analog } = match
  const isGlf = site.kind === 'glf'
  const lightMin = MEAN_EARTH_MARS_DISTANCE_KM / SPEED_OF_LIGHT_KMS / 60

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4 sm:bottom-8">
      <HudPanel
        ref={dialog}
        as="section"
        role="dialog"
        aria-labelledby="flight-plan-title"
        cut={20}
        className="pointer-events-auto w-[min(680px,96vw)]"
        contentClassName="px-5 pb-5 pt-4 sm:px-6"
      >
        <div className="flex items-center justify-between">
          <div className="hud-label">Flight plan</div>
          <div className="font-mono text-[10.5px] text-white/70">
            Δ {(MEAN_EARTH_MARS_DISTANCE_KM / 1e6).toFixed(0)} M km · {lightMin.toFixed(1)} light-min
          </div>
        </div>
        <h2 id="flight-plan-title" className="hud-title mt-1 text-xl uppercase tracking-[0.14em]">
          Mars <span className="text-ice">→</span> Earth
        </h2>

        <div className="mt-3 grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div className="relative px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(25,227,255,0.35),inset_3px_0_0_0_#19e3ff]">
            <div className="hud-label !text-[9.5px]">Origin · Mars</div>
            <div className="font-display text-[15px] font-semibold text-white">{site.name}</div>
            <div className="font-mono text-[10.5px] text-white/70">{formatLatLon(site.lat, site.lon)}</div>
            {isGlf && (
              <div className="mt-1 font-mono text-[10.5px] text-white/80">
                GLF-{site.number} · L {fmt(site.lengthKm)} km · z̄ {fmt(site.elevation?.mean, 0)} m
              </div>
            )}
          </div>

          <div className="hidden flex-col items-center sm:flex" aria-hidden="true">
            <svg width="120" height="44" viewBox="0 0 120 44">
              <path d="M4,22 H116" stroke="#19e3ff" strokeOpacity="0.25" strokeWidth="2" />
              <path d="M4,22 H116" stroke="#ffb347" strokeWidth="2" strokeDasharray="6 6" className="hud-flow" />
              <path d="M106,14 L116,22 L106,30" fill="none" stroke="#ffb347" strokeWidth="2" />
              <circle cx="4" cy="22" r="4" fill="#19e3ff" />
            </svg>
            <span className="font-display text-[9.5px] font-semibold tracking-[0.2em] text-white/70">TRANSFER</span>
          </div>

          <div className="relative flex items-center gap-3 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,179,71,0.45),inset_3px_0_0_0_#ffb347]">
            <div className="min-w-0 flex-1">
              <div className="hud-label hud-label--amber !text-[9.5px]">Destination · Andes</div>
              <div className="truncate font-display text-[15px] font-semibold text-[#fff4e0]">{analog.name}</div>
              <div className="font-mono text-[10.5px] text-white/70">{formatLatLon(analog.lat, analog.lon)}</div>
              <div className="mt-1 truncate font-mono text-[10.5px] text-[#ffd9a6]">
                {analog.code} · {analog.sector.province}
              </div>
            </div>
            <HudRing size={58} tone="amber" progress={match.score / 100}>
              <span className="font-display text-[13px] font-bold tabular-nums text-[#fff4e0]">{match.score.toFixed(0)}</span>
              <span className="font-display text-[7px] font-bold tracking-[0.18em] text-amber">MATCH</span>
            </HudRing>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
          <ConditionBars match={match} />
          <RunnerUps match={match} />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto hidden font-mono text-[10px] text-white/55 sm:inline">ENTER launch · ESC abort</span>
          <button type="button" className="hud-btn hud-btn--danger" onClick={cancel}>
            Abort
          </button>
          <button ref={launch} type="button" className="hud-btn hud-btn--amber" onClick={confirm}>
            Launch to Earth ▸
          </button>
        </div>
      </HudPanel>
    </div>
  )
}

/* ── Arrival ────────────────────────────────────────────────────────────────────────────────── */
export function ArrivalPopout() {
  const match = useMissionStore((s) => s.selectedAnalog)
  const data = useMissionStore((s) => s.andes.data)
  const show = usePhaseFlash('transit', 'earth', 4200)
  const { mounted, leaving } = usePresence(show)
  const last = useRef(match)
  if (show && match) last.current = match
  const m = last.current
  if (!mounted || !m || !data) return null
  return (
    // Wide screens only: it sits in the column between the Earth panel (340 px) and the
    // comparison panel (400 px); on smaller screens the panels already carry the same read-out.
    <div
      className={`pointer-events-none absolute left-[calc(340px+2rem)] right-[calc(400px+2rem)] top-28 hidden justify-center px-2 xl:flex ${leaving ? 'hud-leaving' : ''}`}
    >
      <HudPanel tone="amber" cut={14} contentClassName="flex items-center gap-4 px-5 py-3.5">
        <HudRing size={68} tone="amber" progress={m.score / 100}>
          <span className="font-display text-[15px] font-bold tabular-nums text-[#fff4e0]">
            <CountUp value={m.score} format={(v) => v.toFixed(1)} />
          </span>
          <span className="font-display text-[7px] font-bold tracking-[0.18em] text-amber">LOCK</span>
        </HudRing>
        <div className="min-w-0">
          <div className="hud-label hud-label--amber">Analog site acquired</div>
          <div className="truncate font-display text-lg font-semibold text-[#fff4e0]">
            <Typewriter text={m.analog.name} speed={26} />
          </div>
          <div className="truncate font-mono text-[10.5px] text-white/70">
            {m.analog.code} · #{(m.scorings.site.rank[m.analogIndex] + 1).toLocaleString('en-US')} of {data.glaciers.length.toLocaleString('en-US')}
          </div>
        </div>
      </HudPanel>
    </div>
  )
}
