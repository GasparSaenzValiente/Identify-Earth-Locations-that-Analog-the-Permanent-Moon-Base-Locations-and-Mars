import { useMemo, useState } from 'react'
import { bestIces, pct, rankSectors, rankSurveyPoints } from '../lib/analogScoring'
import { formatLatLon } from '../lib/geo'
import { activeScoring, useMissionStore } from '../store/useMissionStore'
import { EARTH_SCALES } from '../three/earth/andesColors'
import HudPanel from './hud/HudPanel'
import HudRing from './hud/HudRing'
import { ScoreHistogram } from './hud/charts'
import { CountUp, SegmentBar } from './hud/primitives'

function Segmented({ value, options, onChange, label }) {
  return (
    <div className="hud-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Section({ title, children, delay = 0, aside }) {
  return (
    <section className="animate-[hud-pop_0.5s_cubic-bezier(0.2,0.9,0.2,1)_both]" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rotate-45 bg-ice shadow-[0_0_6px_#19e3ff]" />
        <span className="hud-label">{title}</span>
        <span className="hud-rule flex-1" />
        {aside}
      </div>
      {children}
    </section>
  )
}

function Legend({ scale }) {
  const s = EARTH_SCALES[scale]
  return (
    <div className="mt-1.5">
      <div className="h-1.5" style={{ background: s.gradient }} />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-white/70">
        <span>{s.minLabel}</span>
        <span className="text-white/60">{s.label}</span>
        <span>{s.maxLabel}</span>
      </div>
    </div>
  )
}

function LayerToggle({ on, onClick, children, swatch }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex flex-1 items-center gap-2 px-2.5 py-1.5 text-left font-display text-[11px] font-semibold uppercase tracking-[0.14em] transition [clip-path:polygon(6px_0,100%_0,100%_calc(100%-6px),calc(100%-6px)_100%,0_100%,0_6px)] ${
        on ? 'bg-ice/[0.12] text-white shadow-[inset_0_0_0_1px_rgba(25,227,255,0.6)]' : 'bg-white/[0.03] text-white/50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]'
      }`}
    >
      <span className={`h-2 w-2 ${swatch}`} style={{ opacity: on ? 1 : 0.3 }} />
      {children}
    </button>
  )
}

const isWide = () => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 1180px)').matches

/** Earth left panel: Andean inventory read-out, scoring profile, layers and the analog ranking. */
export default function EarthPanel() {
  const phase = useMissionStore((s) => s.phase)
  const match = useMissionStore((s) => s.selectedAnalog)
  const data = useMissionStore((s) => s.andes.data)
  const scoring = useMissionStore(activeScoring)
  const earthProfile = useMissionStore((s) => s.earthProfile)
  const earthColor = useMissionStore((s) => s.earthColor)
  const layers = useMissionStore((s) => s.earthLayers)
  const setEarthProfile = useMissionStore((s) => s.setEarthProfile)
  const setEarthColor = useMissionStore((s) => s.setEarthColor)
  const toggleEarthLayer = useMissionStore((s) => s.toggleEarthLayer)
  const selectEarthGlacier = useMissionStore((s) => s.selectEarthGlacier)
  const storedOpen = useMissionStore((s) => s.earthPanelOpen)
  const setOpenStored = useMissionStore((s) => s.setEarthPanelOpen)
  const open = storedOpen ?? isWide()
  const [expanded, setExpanded] = useState(0)

  const sectors = useMemo(() => (data && scoring ? rankSectors(data, scoring) : []), [data, scoring])
  const points = useMemo(() => (data && scoring ? rankSurveyPoints(data, scoring) : []), [data, scoring])
  const ices = useMemo(() => (data && scoring ? bestIces(data, scoring, 10) : []), [data, scoring])

  if (phase !== 'earth' || !match?.scorings || !data || !scoring) return null

  const n = data.glaciers.length
  let hi = 0
  let mid = 0
  for (let i = 0; i < n; i++) {
    if (scoring.score[i] >= 70) hi += 1
    else if (scoring.score[i] >= 50) mid += 1
  }
  const site = match.marsSite
  const profile = match.profiles.site
  const selectedScore = scoring.score[match.analogIndex]
  const maxBest = sectors[0]?.best ?? 100

  return (
    <HudPanel
      as="aside"
      aria-label="Andean analog ranking"
      cut={18}
      // phones: stop above the comparison bottom sheet (max 56 % of the height)
      className="pointer-events-auto absolute left-4 top-24 flex max-h-[calc(44%-7rem)] w-[min(340px,calc(100vw-2rem))] flex-col sm:top-28 sm:max-h-[calc(100%-11.75rem)]"
      contentClassName="flex min-h-0 flex-1 flex-col"
    >
      <button type="button" className="flex items-center gap-3 px-4 pb-2 pt-4 text-left" onClick={() => setOpenStored(!open)} aria-expanded={open}>
        <HudRing
          size={56}
          segments={[
            { start: 0, length: hi / n, color: '#ffb347' },
            { start: hi / n, length: mid / n, color: '#19e3ff' },
            { start: (hi + mid) / n, length: (n - hi - mid) / n, color: 'rgba(255,255,255,0.25)' },
          ]}
        />
        <div className="min-w-0 flex-1">
          <div className="hud-label">Andean glaciers</div>
          <div className="font-display text-3xl font-bold leading-tight tabular-nums text-white">
            <CountUp value={n} />
          </div>
          <div className="font-mono text-[10.5px] text-white/75">
            <span className="text-amber">{hi.toLocaleString('en-US')} ≥70%</span> · <span className="text-ice">{mid.toLocaleString('en-US')} 50–70%</span> ·{' '}
            {data.survey.length.toLocaleString('en-US')} grid pts
          </div>
        </div>
        <span className="font-display text-ice/80" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-1 [scrollbar-color:rgba(25,227,255,0.4)_transparent] [scrollbar-width:thin]">
          <Section title="Best ices for Mars" delay={40} aside={<span className="font-mono text-[10px] text-white/60">top {ices.length}</span>}>
            <ol className="space-y-1">
              {ices.map((e, k) => {
                const current = e.index === match.analogIndex
                return (
                  <li key={e.index}>
                    <button
                      type="button"
                      onClick={() => selectEarthGlacier(e.index)}
                      aria-current={current ? 'true' : undefined}
                      className={`group grid w-full grid-cols-[2rem_1fr_auto] items-center gap-x-2 gap-y-1 px-2 py-1.5 text-left transition hover:bg-amber/[0.12] ${
                        current ? 'bg-amber/[0.14] shadow-[inset_0_0_0_1px_rgba(255,179,71,0.55)]' : k < 3 ? 'bg-amber/[0.05]' : ''
                      }`}
                    >
                      <span
                        className={`flex h-6 w-7 items-center justify-center font-display text-[11px] font-bold [clip-path:polygon(5px_0,100%_0,100%_calc(100%-5px),calc(100%-5px)_100%,0_100%,0_5px)] ${
                          k === 0 ? 'bg-amber text-[#1a1004]' : k < 3 ? 'bg-amber/30 text-amber' : 'bg-white/[0.06] text-white/70'
                        }`}
                      >
                        {k + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-white/95">{e.glacier.name}</span>
                        <span className="block truncate font-mono text-[10px] text-white/55">
                          {e.glacier.code} · {e.glacier.sector.province}
                          {e.cellSize > 1 ? ` · +${e.cellSize - 1} alike` : ''}
                        </span>
                      </span>
                      <span className="text-right font-mono text-[12px] font-semibold text-amber">{pct(e.score)}</span>
                      <span />
                      <SegmentBar className="col-span-2" value={e.score / 100} segments={26} stagger={5 + k} tone="amber" />
                    </button>
                  </li>
                )
              })}
            </ol>
          </Section>

          <Section title="Mars conditions" delay={60}>
            <Segmented
              label="Scoring profile"
              value={earthProfile}
              onChange={setEarthProfile}
              options={[
                { value: 'site', label: site.kind === 'glf' ? `GLF-${site.number}` : 'This site' },
                { value: 'reference', label: 'Pipeline reference' },
              ]}
            />
            <div className="mt-2 grid grid-cols-4 gap-1.5 text-center font-mono text-[10px]">
              {[
                ['P', `${Math.round(scoring.values.p_superficie)}`, 'Pa'],
                ['T', scoring.values.t_superficie.toFixed(0), 'K'],
                ['ρ', scoring.values.rho_aire.toFixed(3), 'kg/m³'],
                ['S', scoring.values.solar.toFixed(0), 'W/m²'],
              ].map(([k, v, u]) => (
                <div key={k} className="bg-ice/[0.06] px-1 py-1 shadow-[inset_0_0_0_1px_rgba(25,227,255,0.22)]">
                  <div className="text-ice">{k}</div>
                  <div className="text-[12px] text-white">{v}</div>
                  <div className="text-white/55">{u}</div>
                </div>
              ))}
            </div>
            {earthProfile === 'site' && (
              <div className="mt-1.5 font-mono text-[10px] text-white/60">
                {formatLatLon(site.lat, site.lon, 1)} · z {Math.round(profile.elevationM).toLocaleString('en-US')} m · insolation ×{profile.insolationRatio.toFixed(2)}
              </div>
            )}
          </Section>

          <Section title="Match distribution" delay={110} aside={<span className="font-mono text-[10px] text-white/60">n = {n.toLocaleString('en-US')}</span>}>
            <ScoreHistogram bins={scoring.histogram} marker={selectedScore} mean={scoring.mean} />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-white/70">
              <span>0%</span>
              <span>
                best <span className="text-amber">{pct(scoring.max)}</span> · median {pct(scoring.median)} · mean {pct(scoring.mean)}
              </span>
              <span>100%</span>
            </div>
          </Section>

          <Section title="Layers" delay={160}>
            <div className="flex gap-1.5">
              <LayerToggle on={layers.glaciers} onClick={() => toggleEarthLayer('glaciers')} swatch="rotate-45 bg-amber">
                Glaciers
              </LayerToggle>
              <LayerToggle on={layers.survey} onClick={() => toggleEarthLayer('survey')} swatch="bg-[#5fd6c9] [clip-path:polygon(25%_0,75%_0,100%_50%,75%_100%,25%_100%,0_50%)]">
                Survey grid
              </LayerToggle>
            </div>
            <div className="mt-2">
              <Segmented
                label="Glacier colour"
                value={earthColor}
                onChange={setEarthColor}
                options={[
                  { value: 'match', label: 'Mars match' },
                  { value: 'absolute', label: 'Absolute' },
                ]}
              />
              <Legend scale={earthColor} />
              {layers.survey && <Legend scale="survey" />}
            </div>
          </Section>

          <Section title="Best analog sectors" delay={210} aside={<span className="font-mono text-[10px] text-white/60">{sectors.length}</span>}>
            <ol className="space-y-1">
              {sectors.map((r, i) => {
                const isOpen = expanded === i
                return (
                  <li key={r.sector.name} className={isOpen ? 'bg-ice/[0.05] shadow-[inset_0_0_0_1px_rgba(25,227,255,0.25)]' : ''}>
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? -1 : i)}
                      aria-expanded={isOpen}
                      className="group grid w-full grid-cols-[1.6rem_1fr_auto] items-center gap-x-2 gap-y-1 px-2 py-1.5 text-left transition hover:bg-ice/[0.07]"
                    >
                      <span className={`font-mono text-[11px] ${i < 3 ? 'text-amber' : 'text-white/55'}`}>{String(i + 1).padStart(2, '0')}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium text-white/90 group-hover:text-white">{r.sector.name}</span>
                        <span className="block truncate font-mono text-[10px] text-white/55">
                          {r.sector.province} · {r.count.toLocaleString('en-US')} ices
                        </span>
                      </span>
                      <span className="text-right font-mono text-[11px]">
                        <span className="block text-amber">{pct(r.best)}</span>
                        <span className="block text-[10px] text-white/55">μ {pct(r.mean, 0)}</span>
                      </span>
                      <span />
                      <SegmentBar className="col-span-2" value={r.best / maxBest} segments={26} stagger={6 + i} tone="amber" />
                    </button>
                    {isOpen && (
                      <ul className="space-y-0.5 px-2 pb-2 pl-9 animate-[hud-pop_0.35s_cubic-bezier(0.2,0.9,0.2,1)_both]">
                        {r.top.map((gi, k) => {
                          const g = data.glaciers[gi]
                          const current = gi === match.analogIndex
                          return (
                            <li key={gi}>
                              <button
                                type="button"
                                onClick={() => selectEarthGlacier(gi)}
                                className={`flex w-full items-center gap-2 px-2 py-1 text-left font-mono text-[10.5px] transition hover:bg-amber/[0.12] ${current ? 'bg-amber/[0.14] text-white' : 'text-white/80'}`}
                              >
                                <span className="h-1.5 w-1.5 rotate-45 bg-amber" style={{ opacity: 1 - k * 0.25 }} />
                                <span className="flex-1 truncate">{g.benchmark ? g.benchmark.name : g.code}</span>
                                <span className="text-amber">{pct(scoring.score[gi])}</span>
                                <span className="w-12 text-right text-white/50">#{(scoring.rank[gi] + 1).toLocaleString('en-US')}</span>
                              </button>
                            </li>
                          )
                        })}
                        <li className="flex justify-between px-2 pt-1 font-mono text-[10px] text-white/55">
                          <span>≥70%: {pct(100 * r.shareAbove70, 0)} of ices</span>
                          <span>{r.surveyMean != null ? `soil ${pct(r.surveyMean, 0)} · ${r.surveyInDomain}/${r.surveyCount} pts` : `soil — · 0/${r.surveyCount} pts`}</span>
                        </li>
                      </ul>
                    )}
                  </li>
                )
              })}
            </ol>
          </Section>

          <Section title="Survey grid · best points" delay={260}>
            <div className="mb-1 flex justify-end gap-3 px-2 font-display text-[9px] font-semibold uppercase tracking-[0.18em]">
              <span className="text-[#8ff0e2]">Soil</span>
              <span className="text-amber">Match</span>
            </div>
            <ul className="space-y-1">
              {points.map((e) => (
                <li key={e.point.id}>
                  <button
                    type="button"
                    onClick={() => selectEarthGlacier(e.glacier.index)}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 px-2 py-1 text-left transition hover:bg-ice/[0.07]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[11px] text-white/90">
                        <span className="text-[#5fd6c9]">◆</span> {formatLatLon(e.point.lat, e.point.lon, 1)}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-white/55">
                        {e.glacier.name} · {e.count} ices
                      </span>
                    </span>
                    <span className="flex gap-3 text-right font-mono text-[10.5px]">
                      <span className="text-[#8ff0e2]">{pct(e.point.absolute)}</span>
                      <span className="text-amber">{pct(e.glacierScore)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </HudPanel>
  )
}
