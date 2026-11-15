import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { MARS_RADIUS } from '../../config/scene'
import { formatLatLon, latLonToVector3 } from '../../lib/geo'
import { marsSiteProfile } from '../../lib/marsEnvironment'
import { isOccludedByPlanets } from '../../lib/occlusion'
import { useMissionStore } from '../../store/useMissionStore'
import { Reticle } from '../../ui/hud/HudRing'
import { SegmentBar } from '../../ui/hud/primitives'
import Html from '../SceneHtml'
import { IS_TOUCH } from './GlacierMarkers'

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—')
const CALLOUT_WIDTH = 300
const _p = new Vector3()

/** Leader line from the reticle to the callout box. */
function Leader({ color }) {
  return (
    <svg className="glf-callout__leader" width="64" height="40" aria-hidden="true">
      <path d="M15,25 L34,1 H64" fill="none" stroke={color} strokeWidth="1.5" />
      <circle cx="64" cy="1" r="2" fill={color} />
    </svg>
  )
}

/** Local surface conditions of the GLF (pressure from its MOLA elevation, temperature from latitude). */
function EnvRow({ site, reference }) {
  const { values } = marsSiteProfile({ lat: site.lat, elevationM: site.elevation?.mean }, reference)
  return (
    <>
      <span>ENV</span>
      <span className="col-span-2 text-left text-ice-soft">
        {Math.round(values.p_superficie)} Pa · {values.t_superficie.toFixed(0)} K · {values.solar.toFixed(0)} W/m²
      </span>
    </>
  )
}

/**
 * Action 2 — hover: a targeting reticle on the marker, a leader line and a HUD callout with the
 * glacier's morphometry. The <Html> portal stays mounted (see three/SceneHtml.jsx); only its
 * content toggles. The callout flips to the left near the right edge of the screen.
 */
export default function GlacierTooltip() {
  const hovered = useMissionStore((s) => s.hovered)
  const phase = useMissionStore((s) => s.phase)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const { position, flip } = useMemo(() => {
    if (!hovered) return { position: [0, 0, 0], flip: false }
    const v = latLonToVector3(hovered.lat, hovered.lon, MARS_RADIUS * 1.004)
    const x = ((v.clone().project(camera).x + 1) / 2) * size.width
    return { position: v.toArray(), flip: x > size.width - CALLOUT_WIDTH - 24 }
  }, [hovered, camera, size])

  const reference = useMissionStore((s) => s.andes.data?.reference)
  const show = hovered && phase === 'mars' && (hovered.kind === 'glf' || hovered.kind === 'reference')
  const isGlf = hovered?.kind === 'glf'
  const color = isGlf ? '#19e3ff' : '#ffb347'

  // On touch the preview persists after the tap: hide it if the user rotates the site out of view.
  const wrap = useRef(null)
  useFrame(({ camera }) => {
    if (!wrap.current) return
    _p.fromArray(position)
    wrap.current.style.visibility = isOccludedByPlanets(camera.position, _p) ? 'hidden' : 'visible'
  })

  return (
    <Html position={position} zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={wrap}>
      {show && (
        <div key={hovered.id} className={`glf-callout ${isGlf ? '' : 'glf-callout--ref'} ${flip ? 'glf-callout--left' : ''}`}>
          <Reticle className="glf-callout__reticle" tone={isGlf ? 'ice' : 'amber'} />
          <div style={flip ? { transform: 'scaleX(-1)' } : undefined}>
            <Leader color={color} />
          </div>
          <div className="glf-tooltip" role="tooltip">
            <div className="glf-tooltip__eyebrow">{isGlf ? `GLF-${hovered.number}` : 'Reference site'}</div>
            <div className="glf-tooltip__name">{hovered.name}</div>
            <div className="glf-tooltip__coords">{formatLatLon(hovered.lat, hovered.lon)}</div>
            {isGlf && (
              <div className="glf-tooltip__rows">
                <span>LEN</span>
                <SegmentBar value={(hovered.lengthKm ?? 0) / 20} segments={12} stagger={12} />
                <span>{fmt(hovered.lengthKm)} km</span>
                <span>WID</span>
                <SegmentBar value={(hovered.widthKm ?? 0) / 6} segments={12} stagger={12} />
                <span>{fmt(hovered.widthKm)} km</span>
                <span>ELV</span>
                <SegmentBar value={((hovered.elevation?.mean ?? 0) + 6000) / 12000} segments={12} stagger={12} />
                <span>{fmt(hovered.elevation?.mean, 0)} m</span>
                {reference && <EnvRow site={hovered} reference={reference} />}
              </div>
            )}
            <div className="glf-tooltip__cta">{IS_TOUCH ? 'Tap again to target ▸' : 'Click to target ▸'}</div>
          </div>
        </div>
      )}
      </div>
    </Html>
  )
}
