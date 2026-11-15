import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { EARTH_CENTER, EARTH_RADIUS } from '../../config/scene'
import { pct } from '../../lib/analogScoring'
import { formatLatLon, latLonToVector3 } from '../../lib/geo'
import { isOccludedByPlanets } from '../../lib/occlusion'
import { THERMAL_STATUS } from '../../services/andesDataService'
import { activeScoring, useMissionStore } from '../../store/useMissionStore'
import { Reticle } from '../../ui/hud/HudRing'
import { SegmentBar } from '../../ui/hud/primitives'
import Html from '../SceneHtml'
import { IS_TOUCH } from '../mars/GlacierMarkers'

const CALLOUT_WIDTH = 300
const _w = new Vector3()

function Leader({ color }) {
  return (
    <svg className="glf-callout__leader" width="64" height="40" aria-hidden="true">
      <path d="M15,25 L34,1 H64" fill="none" stroke={color} strokeWidth="1.5" />
      <circle cx="64" cy="1" r="2" fill={color} />
    </svg>
  )
}

/** Hover callout for Andean glaciers and survey-grid points (positions are Earth-local). */
export default function EarthTooltip() {
  const hovered = useMissionStore((s) => s.hovered)
  const phase = useMissionStore((s) => s.phase)
  const scoring = useMissionStore(activeScoring)
  const analogIndex = useMissionStore((s) => s.selectedAnalog?.analogIndex)
  const glaciers = useMissionStore((s) => s.andes.data?.glaciers)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const kind = hovered?.kind
  const show = phase === 'earth' && (kind === 'andes' || kind === 'survey')

  const { position, flip } = useMemo(() => {
    if (!show) return { position: [0, 0, 0], flip: false }
    const v = latLonToVector3(hovered.lat, hovered.lon, EARTH_RADIUS * 1.0015)
    const x = ((v.clone().add(EARTH_CENTER).project(camera).x + 1) / 2) * size.width
    // the comparison panel (400 px) docks on the right from sm up: flip before reaching it
    const panel = size.width >= 640 ? 424 : 0
    return { position: v.toArray(), flip: x > size.width - panel - CALLOUT_WIDTH - 24 }
  }, [show, hovered, camera, size])

  const wrap = useRef(null)
  useFrame(({ camera }) => {
    if (!wrap.current) return
    _w.fromArray(position).add(EARTH_CENTER)
    wrap.current.style.visibility = isOccludedByPlanets(camera.position, _w) ? 'hidden' : 'visible'
  })

  let body = null
  if (show && kind === 'andes' && scoring) {
    const g = hovered
    const score = scoring.score[g.index]
    const rank = scoring.rank[g.index] + 1
    const selected = g.index === analogIndex
    body = (
      <>
        <div className="glf-tooltip__eyebrow">
          #{rank.toLocaleString('en-US')} of {scoring.score.length.toLocaleString('en-US')} · {g.sector.macro.name}
        </div>
        <div className="glf-tooltip__name">{g.name}</div>
        <div className="glf-tooltip__coords">
          {g.code} · {formatLatLon(g.lat, g.lon)}
        </div>
        <div className="glf-tooltip__rows">
          <span>MATCH</span>
          <SegmentBar value={score / 100} segments={12} stagger={12} tone="amber" />
          <span>{pct(score)}</span>
          <span>ABS·REF</span>
          <SegmentBar value={g.absolute / 100} segments={12} stagger={12} />
          <span>{pct(g.absolute)}</span>
          <span>THERM</span>
          <span className="col-span-2 text-left">{THERMAL_STATUS[g.thermal].label}</span>
        </div>
        <div className="glf-tooltip__cta">{selected ? 'Current analog' : IS_TOUCH ? 'Tap again to compare ▸' : 'Click to compare ▸'}</div>
      </>
    )
  } else if (show && kind === 'survey') {
    const p = hovered
    const inDomain = p.thermal === 0
    const linked = glaciers ? countLinked(glaciers, p.index) : 0
    body = (
      <>
        <div className="glf-tooltip__eyebrow">Survey point {p.number}</div>
        <div className="glf-tooltip__name">Uniform Andes grid</div>
        <div className="glf-tooltip__coords">{formatLatLon(p.lat, p.lon)}</div>
        <div className="glf-tooltip__rows">
          <span>SOIL</span>
          <SegmentBar value={p.absolute / 100} segments={12} stagger={12} />
          <span>{inDomain ? pct(p.absolute) : '—'}</span>
          <span>THERM</span>
          <span className="col-span-2 text-left">{THERMAL_STATUS[p.thermal].label}</span>
          <span>ICE</span>
          <span className="col-span-2 text-left">{linked ? `${linked} inventoried glaciers nearest` : 'No inventoried glacier linked'}</span>
        </div>
      </>
    )
  }

  return (
    <Html position={position} zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={wrap}>
        {body && (
          <div key={hovered.id} className={`glf-callout ${kind === 'survey' ? '' : 'glf-callout--ref'} ${flip ? 'glf-callout--left' : ''}`}>
            <Reticle className="glf-callout__reticle" tone={kind === 'survey' ? 'ice' : 'amber'} />
            <div style={flip ? { transform: 'scaleX(-1)' } : undefined}>
              <Leader color={kind === 'survey' ? '#19e3ff' : '#ffb347'} />
            </div>
            <div className="glf-tooltip" role="tooltip">
              {body}
            </div>
          </div>
        )}
      </div>
    </Html>
  )
}

const linkedCache = new WeakMap()
function countLinked(glaciers, surveyIndex) {
  let counts = linkedCache.get(glaciers)
  if (!counts) {
    counts = new Map()
    for (const g of glaciers) if (g.surveyKm <= 60) counts.set(g.surveyIndex, (counts.get(g.surveyIndex) ?? 0) + 1)
    linkedCache.set(glaciers, counts)
  }
  return counts.get(surveyIndex) ?? 0
}
