import { useEffect, useMemo, useRef, useState } from 'react'
import { compareGlacier, formatRatio, formatValue, PARAM_INFO, pct } from '../lib/analogScoring'
import { formatLatLon } from '../lib/geo'
import { THERMAL_STATUS } from '../services/andesDataService'
import { activeScoring, useMissionStore } from '../store/useMissionStore'
import HudPanel from './hud/HudPanel'
import HudRing from './hud/HudRing'
import { BandGauge, RadarChart } from './hud/charts'
import { CountUp, SegmentBar } from './hud/primitives'

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—')

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[12.5px]">
      <span className="font-display text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/65">{label}</span>
      <span className="text-right text-white/90">{children}</span>
    </div>
  )
}

function SubHead({ children, tone = 'amber' }) {
  return (
    <div className="mb-1.5 mt-4 flex items-center gap-2 first:mt-0">
      <span className={`h-1.5 w-1.5 rotate-45 ${tone === 'amber' ? 'bg-amber shadow-[0_0_6px_#ffb347]' : 'bg-ice shadow-[0_0_6px_#19e3ff]'}`} />
      <span className={`hud-label ${tone === 'amber' ? 'hud-label--amber' : ''}`}>{children}</span>
      <span className="hud-rule flex-1" />
    </div>
  )
}

const TABS = [
  { key: 'match', label: 'Match' },
  { key: 'params', label: 'Parameters' },
  { key: 'origin', label: 'Mars ↔ Earth' },
]

/* ── Match tab ──────────────────────────────────────────────────────────────────────────────── */
function MatchTab({ cmp, siteCmp, refCmp, data, glacier }) {
  // the survey grid covers the Andes only (South Georgia's nearest point is ~1,700 km away)
  const survey = glacier.surveyIndex >= 0 && glacier.surveyKm <= 60 ? data.survey[glacier.surveyIndex] : null
  const thermal = THERMAL_STATUS[glacier.thermal]
  return (
    <>
      <div className="flex items-center gap-4">
        <HudRing size={96} tone="amber" progress={cmp.score / 100}>
          <span className="font-display text-[22px] font-bold leading-none tabular-nums text-[#fff4e0]">
            <CountUp key={glacier.id} value={cmp.score} duration={900} format={(v) => v.toFixed(1)} />
          </span>
          <span className="font-display text-[8.5px] font-bold tracking-[0.18em] text-amber">{cmp === refCmp ? 'REF %' : 'REL %'}</span>
        </HudRing>
        <div className="min-w-0 flex-1 space-y-1.5 font-mono text-[10.5px] text-white/85">
          <div className="grid grid-cols-[4.6rem_1fr_auto] items-center gap-2">
            <span className="text-amber">THIS SITE</span>
            <SegmentBar value={siteCmp.score / 100} segments={14} tone="amber" />
            <span>{pct(siteCmp.score)}</span>
          </div>
          <div className="grid grid-cols-[4.6rem_1fr_auto] items-center gap-2">
            <span className="text-ice">REFERENCE</span>
            <SegmentBar value={refCmp.score / 100} segments={14} />
            <span>{pct(refCmp.score)}</span>
          </div>
          <div className="grid grid-cols-[4.6rem_1fr_auto] items-center gap-2">
            <span className="text-white/70">ABS · REF</span>
            <SegmentBar value={glacier.absolute / 100} segments={14} />
            <span>{pct(glacier.absolute)}</span>
          </div>
          <div className="pt-0.5 text-white/65">
            Top <span className="text-amber">{pct(100 - cmp.percentile + 100 / cmp.total, cmp.percentile > 99 ? 2 : 1)}</span> · #{cmp.rank.toLocaleString('en-US')} /{' '}
            {cmp.total.toLocaleString('en-US')}
          </div>
        </div>
      </div>

      <SubHead>Similarity per parameter</SubHead>
      <div className="flex items-center gap-2">
        <RadarChart
          size={200}
          animateKey={glacier.id}
          axes={siteCmp.rows.map((r) => ({ key: r.key, label: r.symbol }))}
          series={[
            { values: siteCmp.rows.map((r) => r.sim), tone: 'amber' },
            { values: refCmp.rows.map((r) => r.sim), tone: 'ice', dashed: true },
          ]}
        />
        <div className="flex-1 space-y-1 font-mono text-[10px] text-white/75">
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-amber" /> This site
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed border-ice" /> Reference
          </div>
          {siteCmp.rows.map((r, k) => (
            <div key={r.key} className="grid grid-cols-[1fr_auto_auto] gap-2">
              <span className="text-white/60">{r.symbol}</span>
              <span className={r.sim >= 0.75 ? 'text-amber' : r.sim <= 0.25 ? 'text-alert' : ''}>{r.sim.toFixed(2)}</span>
              <span className="text-ice/70">{refCmp.rows[k].sim.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <SubHead>Stage contribution</SubHead>
      <div className="space-y-2">
        {cmp.stages.map((s) => (
          <div key={s.key}>
            <div className="flex items-baseline justify-between font-mono text-[10.5px]">
              <span>
                <span className="text-amber">{s.key}</span> <span className="text-white/85">{s.label}</span>{' '}
                <span className="text-white/50">w{s.weight}</span>
              </span>
              <span className="text-white/85">
                {s.points.toFixed(1)} / {s.maxPoints.toFixed(1)} pts
              </span>
            </div>
            <div className="relative mt-1 h-2 bg-white/[0.06]" style={{ width: `${(s.maxPoints / 45.5) * 100}%` }}>
              <div className="absolute inset-y-0 left-0 bg-amber shadow-[0_0_8px_#ffb347] transition-[width] duration-700" style={{ width: `${s.sim * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      <SubHead tone="ice">Data coverage</SubHead>
      <Row label="Common parameters">
        <span className="font-mono">{cmp.rows.length} · relative to common set</span>
      </Row>
      <Row label="Soil thermal model">
        <span className={thermal.ok ? 'text-ice' : 'text-white/70'}>{thermal.label}</span>
      </Row>
      <Row label="ERA5-Land">
        <span className="text-white/70">{glacier.era5 ? 'Included' : 'Omitted'}</span>
      </Row>
      {survey && (
        <Row label="Survey point">
          <span className="font-mono">
            #{survey.number} · {fmt(glacier.surveyKm, 0)} km · soil {survey.thermal === 0 ? pct(survey.absolute) : '—'}
          </span>
        </Row>
      )}
    </>
  )
}

/* ── Parameters tab ─────────────────────────────────────────────────────────────────────────── */
function ParamsTab({ cmp }) {
  return (
    <>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-ice/20 pb-1 font-display text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/55">
        <span>Parameter</span>
        <span className="text-right text-amber">Earth · cell</span>
        <span className="w-[4.6rem] text-right text-ice">Mars</span>
      </div>
      <ul className="divide-y divide-white/[0.06]">
        {cmp.rows.map((r, i) => (
          <li key={r.key} className="py-2 animate-[hud-pop_0.4s_cubic-bezier(0.2,0.9,0.2,1)_both]" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3">
              <span className="min-w-0 truncate text-[12.5px] text-white/90">
                <span className="font-mono text-ice-soft">{r.symbol}</span> {r.label}
              </span>
              <span className="text-right font-mono text-[11px] text-[#ffd9a6]">{formatValue(r.earth, r.digits)}</span>
              <span className="w-[4.6rem] text-right font-mono text-[11px] text-ice-soft">{formatValue(r.mars, r.digits)}</span>
            </div>
            <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-x-3 font-mono text-[10px] text-white/60">
              <BandGauge distance={r.distance} lo={r.lo} hi={r.hi} />
              <span>
                {PARAM_INFO[r.key].unit} · {formatRatio(r.earth, r.mars)}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 font-mono text-[10px]">
              <span className="text-white/55">
                {r.stage} w{r.weight} · |ln| {r.distance.toFixed(3)}
              </span>
              <SegmentBar value={r.sim} segments={12} tone="amber" stagger={10} />
              <span className="text-white/85">
                {r.sim.toFixed(2)} · <span className="text-amber">{r.points.toFixed(1)}</span>
                <span className="text-white/45">/{r.maxPoints.toFixed(1)}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 space-y-0.5 bg-ice/[0.05] px-2.5 py-2 font-mono text-[10px] leading-relaxed text-white/70 shadow-[inset_0_0_0_1px_rgba(25,227,255,0.2)]">
        <div>
          sim = clamp(1 − (|ln E/M| − P5) / (P95 − P5))
        </div>
        <div>
          match = Σ w·sim / Σ w = <span className="text-amber">{pct(cmp.score, 2)}</span>
        </div>
      </div>
    </>
  )
}

/* ── Mars ↔ Earth tab ───────────────────────────────────────────────────────────────────────── */
function OriginTab({ match, site, scoring, data }) {
  const profile = match.profiles.site
  const ref = match.profiles.reference.values
  const isGlf = site?.kind === 'glf'
  const alternatives = Array.from(scoring.order.subarray(0, 6))
  const selectEarthGlacier = useMissionStore.getState().selectEarthGlacier
  return (
    <>
      <SubHead tone="ice">Origin · Mars</SubHead>
      <div className="font-display text-[16px] font-semibold text-white">
        {site?.name}
        {isGlf && <span className="ml-2 font-mono text-[11px] font-normal text-white/65">GLF-{site.number}</span>}
      </div>
      <div className="font-mono text-[11px] text-white/70">{site && formatLatLon(site.lat, site.lon)}</div>
      {isGlf && (
        <div className="mt-2.5 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5 font-mono text-[10.5px] text-white/85">
          <span className="text-ice">LEN</span>
          <SegmentBar value={(site.lengthKm ?? 0) / 20} segments={16} />
          <span>{fmt(site.lengthKm)} km</span>
          <span className="text-ice">WID</span>
          <SegmentBar value={(site.widthKm ?? 0) / 6} segments={16} />
          <span>{fmt(site.widthKm)} km</span>
          <span className="text-ice">ELV</span>
          <SegmentBar value={((site.elevation?.mean ?? 0) + 6000) / 12000} segments={16} />
          <span>{fmt(site.elevation?.mean, 0)} m</span>
        </div>
      )}

      <SubHead tone="ice">Site vs pipeline reference</SubHead>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 font-mono text-[10.5px]">
        <span className="font-display text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/50" />
        <span className="text-right font-display text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ice">Site</span>
        <span className="text-right font-display text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/55">Ref</span>
        <span className="text-right font-display text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/55">Δ</span>
        {data.params.map((p) => {
          const info = PARAM_INFO[p.key]
          const a = profile.values[p.key]
          const b = ref[p.key]
          const d = (a / b - 1) * 100
          return (
            <span key={p.key} className="contents">
              <span className="text-white/75">
                {info.symbol} <span className="text-white/45">{info.unit}</span>
              </span>
              <span className="text-right text-white">{formatValue(a, info.digits)}</span>
              <span className="text-right text-white/60">{formatValue(b, info.digits)}</span>
              <span className={`text-right ${Math.abs(d) < 0.05 ? 'text-white/40' : d > 0 ? 'text-amber' : 'text-ice'}`}>
                {Math.abs(d) < 0.05 ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}%`}
              </span>
            </span>
          )
        })}
      </div>
      <div className="mt-1.5 font-mono text-[10px] text-white/55">
        z {Math.round(profile.elevationM).toLocaleString('en-US')} m ({profile.elevationSource}) · insolation ×{profile.insolationRatio.toFixed(3)}
      </div>

      <SubHead>Ranking for this site</SubHead>
      <ol className="space-y-0.5">
        {alternatives.map((gi, k) => {
          const g = data.glaciers[gi]
          const current = gi === match.analogIndex
          return (
            <li key={gi}>
              <button
                type="button"
                onClick={() => selectEarthGlacier(gi)}
                className={`grid w-full grid-cols-[1.4rem_1fr_auto] items-center gap-x-2 px-2 py-1 text-left transition hover:bg-amber/[0.12] ${current ? 'bg-amber/[0.14]' : ''}`}
              >
                <span className="font-mono text-[10.5px] text-amber">{k + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] text-white/90">{g.name}</span>
                  <span className="block truncate font-mono text-[10px] text-white/55">{g.code}</span>
                </span>
                <span className="font-mono text-[11px] text-amber">{pct(scoring.score[gi])}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </>
  )
}

/**
 * Scene 2 panel: the full Mars ↔ Andes comparison for the glacier being compared.
 * Docked at the bottom on phones (the camera keeps the analog in the upper part of the view).
 */
export default function AnalogPanel() {
  const phase = useMissionStore((s) => s.phase)
  const match = useMissionStore((s) => s.selectedAnalog)
  const site = useMissionStore((s) => s.selectedMarsSite)
  const data = useMissionStore((s) => s.andes.data)
  const scoring = useMissionStore(activeScoring)
  const returnToMars = useMissionStore((s) => s.returnToMars)
  const [tab, setTab] = useState('match')
  const heading = useRef()
  const visible = phase === 'earth' && !!match?.scorings && !!data && !!scoring

  // Move keyboard / screen-reader focus to the result when we land (the Mars panel just unmounted).
  useEffect(() => {
    if (visible) heading.current?.focus({ preventScroll: true })
  }, [visible])

  const siteCmp = useMemo(() => (visible ? compareGlacier(data, match.scorings.site, match.analogIndex) : null), [visible, data, match])
  const refCmp = useMemo(() => (visible ? compareGlacier(data, match.scorings.reference, match.analogIndex) : null), [visible, data, match])
  // ring, rank and parameter table follow the profile chosen in the Earth panel
  const cmp = scoring === match?.scorings?.reference ? refCmp : siteCmp

  if (!visible || !cmp) return null

  const g = match.analog
  const mapsUrl = `https://www.google.com/maps/@${g.lat},${g.lon},14z/data=!3m1!1e3`

  return (
    <HudPanel
      as="aside"
      aria-label="Mars – Andes comparison"
      tone="amber"
      cut={18}
      delay={350}
      // flex column + min-h-0 child: the content scrolls inside the clamped panel (a percentage
      // max-height on the child would resolve against an indefinite height and never scroll)
      className="pointer-events-auto absolute inset-x-4 bottom-4 flex max-h-[56%] flex-col sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-28 sm:max-h-[calc(100%-11.75rem)] sm:w-[400px]"
      contentClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="px-5 pt-5">
        <div className="hud-label hud-label--amber">
          Andean analog · #{cmp.rank.toLocaleString('en-US')} of {cmp.total.toLocaleString('en-US')}
        </div>
        <h2 ref={heading} tabIndex={-1} key={g.id} className="hud-title mt-1 text-[22px] leading-tight text-[#fff4e0] outline-none animate-[hud-pop_0.45s_cubic-bezier(0.2,0.9,0.2,1)_both]">
          {g.name}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="hud-chip hud-chip--amber">
            <span className="h-1.5 w-1.5 rotate-45 bg-amber" />
            {g.code}
          </span>
          <span className="hud-chip text-white/85">{g.sector.province}</span>
          <span className="hud-chip text-white/85">{g.sector.macro.name}</span>
          <span className="hud-chip text-white/75">{formatLatLon(g.lat, g.lon)}</span>
        </div>
        <div className="hud-seg mt-3" role="tablist" aria-label="Comparison view">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div
        key={tab}
        role="tabpanel"
        className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-3 animate-[hud-pop_0.35s_cubic-bezier(0.2,0.9,0.2,1)_both] [scrollbar-color:rgba(255,179,71,0.45)_transparent] [scrollbar-width:thin]"
      >
        {tab === 'match' && <MatchTab cmp={cmp} siteCmp={siteCmp} refCmp={refCmp} data={data} glacier={g} />}
        {tab === 'params' && <ParamsTab cmp={cmp} />}
        {tab === 'origin' && <OriginTab match={match} site={site} scoring={scoring} data={data} />}
      </div>

      <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-2 border-t border-amber/20 px-5 pb-4 pt-3 max-sm:grid-cols-2">
        <button type="button" className="hud-btn whitespace-nowrap !px-2 !text-[10.5px] max-sm:col-span-2" onClick={returnToMars}>
          ◂ Back to Mars
        </button>
        <a className="hud-btn hud-btn--ghost whitespace-nowrap !px-2 !text-[10.5px]" href={mapsUrl} target="_blank" rel="noreferrer">
          Satellite ↗
        </a>
        <a className="hud-btn hud-btn--ghost whitespace-nowrap !px-2 !text-[10.5px]" href="https://www.glaciaresargentinos.gob.ar" target="_blank" rel="noreferrer">
          IANIGLA ↗
        </a>
      </div>
    </HudPanel>
  )
}
