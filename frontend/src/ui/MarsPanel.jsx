import { useRef } from 'react'
import { formatLatLon } from '../lib/geo'
import { useMissionStore } from '../store/useMissionStore'
import { COLOR_SCALES } from '../three/mars/GlacierMarkers'
import HudPanel from './hud/HudPanel'
import HudRing from './hud/HudRing'
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

function Section({ title, children, delay = 0 }) {
  return (
    <section className="animate-[hud-pop_0.5s_cubic-bezier(0.2,0.9,0.2,1)_both]" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rotate-45 bg-ice shadow-[0_0_6px_#19e3ff]" />
        <span className="hud-label">{title}</span>
        <span className="hud-rule flex-1" />
      </div>
      {children}
    </section>
  )
}

function Legend({ mode }) {
  const s = COLOR_SCALES[mode]
  return (
    <div className="mt-2">
      <div className="h-1.5" style={{ background: s.gradient }} />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-white/70">
        <span>{s.minLabel}</span>
        <span>{s.maxLabel}</span>
      </div>
      <div className="text-center font-mono text-[10px] text-white/60">{s.label}</div>
    </div>
  )
}

// Open by default only from md (768px): below that the bottom-centred pop-outs need the space.
const isWide = () => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 768px)').matches
let counted = false // the count-up plays only the first time the panel appears

/** Left panel on Mars: inventory read-out, display options, reference sites and regions. */
export default function MarsPanel() {
  const phase = useMissionStore((s) => s.phase)
  const glf = useMissionStore((s) => s.glf)
  const colorMode = useMissionStore((s) => s.colorMode)
  const basemap = useMissionStore((s) => s.basemap)
  const referenceSites = useMissionStore((s) => s.referenceSites)
  const setColorMode = useMissionStore((s) => s.setColorMode)
  const setBasemap = useMissionStore((s) => s.setBasemap)
  const selectMarsSite = useMissionStore((s) => s.selectMarsSite)
  const focusRegion = useMissionStore((s) => s.focusRegion)
  const showing = useRef(null)
  // Collapse state lives in the store so it survives the panel unmounting during flights.
  const storedOpen = useMissionStore((s) => s.marsPanelOpen)
  const setOpenStored = useMissionStore((s) => s.setMarsPanelOpen)
  const open = storedOpen ?? isWide()
  const setOpen = (fn) => setOpenStored(typeof fn === 'function' ? fn(open) : fn)

  // The count-up plays only on the very first appearance (stable for the whole showing).
  const visible = glf.status === 'ready' && phase === 'mars'
  if (!visible) showing.current = null
  else if (showing.current === null) {
    showing.current = !counted
    counted = true
  }
  if (!visible) return null
  const firstShow = showing.current
  const total = glf.items.length
  const north = glf.items.filter((g) => g.lat >= 0).length
  const maxCount = glf.regions[0]?.count ?? 1

  return (
    <HudPanel
      as="aside"
      aria-label="Glacier-like forms on Mars"
      cut={18}
      className="pointer-events-auto absolute left-4 top-24 flex max-h-[calc(100%-12rem)] w-[min(330px,calc(100vw-2rem))] flex-col sm:top-28 sm:max-h-[calc(100%-11.75rem)]"
      contentClassName="flex min-h-0 flex-1 flex-col"
    >
      <button
        type="button"
        className="flex items-center gap-3 px-4 pb-2 pt-4 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <HudRing
          size={56}
          segments={[
            { start: 0, length: north / total, color: '#19e3ff' },
            { start: north / total, length: (total - north) / total, color: '#ffb347' },
          ]}
        />
        <div className="min-w-0 flex-1">
          <div className="hud-label">Glacier-like forms</div>
          <div className="font-display text-3xl font-bold leading-tight tabular-nums text-white">
            {firstShow ? <CountUp value={total} /> : total.toLocaleString('en-US')}
          </div>
          <div className="font-mono text-[10.5px] text-white/75">
            <span className="text-ice">{north} N</span> · <span className="text-amber">{total - north} S</span>
          </div>
        </div>
        <span className="font-display text-ice/80" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-1 [scrollbar-color:rgba(25,227,255,0.4)_transparent] [scrollbar-width:thin]">
          <p className="text-[13.5px] leading-snug text-white/80">
            Souness et al. (2012) inventory mapped on CTX images. SHARAD radar confirmed buried water ice in the lobate debris
            aprons of <span className="text-white">Deuteronilus Mensae</span> and the <span className="text-white">eastern Hellas rim</span>.
          </p>

          <Section title="Basemap" delay={80}>
            <Segmented
              label="Basemap"
              value={basemap}
              onChange={setBasemap}
              options={[
                { value: 'viking', label: 'Viking colour' },
                { value: 'mola', label: 'MOLA relief' },
              ]}
            />
          </Section>

          <Section title="Marker colour" delay={140}>
            <Segmented
              label="Marker colour"
              value={colorMode}
              onChange={setColorMode}
              options={[
                { value: 'area', label: 'Area' },
                { value: 'elevation', label: 'Elevation' },
              ]}
            />
            <Legend mode={colorMode} />
          </Section>

          <Section title="Reference sites" delay={200}>
            <div className="space-y-1.5">
              {referenceSites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => selectMarsSite(site)}
                  className="group flex w-full items-center gap-3 bg-amber/[0.06] px-3 py-2 text-left shadow-[inset_0_0_0_1px_rgba(255,179,71,0.35)] transition [clip-path:polygon(8px_0,100%_0,100%_calc(100%-8px),calc(100%-8px)_100%,0_100%,0_8px)] hover:bg-amber/[0.14]"
                >
                  <span className="h-2 w-2 rotate-45 bg-amber shadow-[0_0_8px_#ffb347]" />
                  <span className="flex-1">
                    <span className="block font-display text-[13px] font-semibold text-white">{site.name}</span>
                    <span className="block font-mono text-[10.5px] text-white/70">{formatLatLon(site.lat, site.lon, 1)}</span>
                  </span>
                  <span className="font-display text-[10.5px] font-semibold uppercase tracking-[0.16em] text-amber transition group-hover:translate-x-0.5">
                    Target ▸
                  </span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Densest regions" delay={260}>
            <ul className="space-y-1">
              {glf.regions.slice(0, 9).map((r, i) => (
                <li key={r.name}>
                  <button
                    type="button"
                    onClick={() => focusRegion(r.lat, r.lon)}
                    className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-2 py-1 text-left transition hover:bg-ice/[0.07]"
                  >
                    <span className="truncate text-[13.5px] font-medium text-white/90 group-hover:text-white">{r.name}</span>
                    <span className="font-mono text-[11px] text-ice-soft">{r.count}</span>
                    <SegmentBar className="col-span-2" value={r.count / maxCount} segments={24} stagger={8 + i} />
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
