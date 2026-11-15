import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { MARS_RADIUS } from '../../config/scene'
import { latLonToVector3 } from '../../lib/geo'
import { isOccludedByPlanets } from '../../lib/occlusion'
import { useMissionStore } from '../../store/useMissionStore'
import Html from '../SceneHtml'

const _p = new Vector3()

/**
 * Lock-on reticle over the selected glacier while the analog search runs and the flight is being
 * confirmed: corner brackets close in, rings counter-rotate, the tag switches ACQUIRING → LOCKED.
 * Hidden whenever the site is on Mars' far side (drei <Html> does not occlude by itself).
 */
export default function TargetLock() {
  const site = useMissionStore((s) => s.selectedMarsSite)
  const phase = useMissionStore((s) => s.phase)
  const wrap = useRef(null)
  const show = site && (phase === 'matching' || phase === 'confirm')
  const position = useMemo(() => (site ? latLonToVector3(site.lat, site.lon, MARS_RADIUS * 1.004).toArray() : [0, 0, 0]), [site])
  const locked = phase === 'confirm'
  const color = locked ? '#ffb347' : '#19e3ff'

  useFrame(({ camera }) => {
    if (!wrap.current) return
    _p.fromArray(position) // Mars is at the world origin
    wrap.current.style.visibility = isOccludedByPlanets(camera.position, _p) ? 'hidden' : 'visible'
  })

  return (
    <Html position={position} zIndexRange={[35, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={wrap}>
        {show && (
          <div key={`${site.id}-${locked}`} className="target-lock" aria-hidden="true">
            <svg className="target-lock__svg" viewBox="-60 -60 120 120" style={{ filter: `drop-shadow(0 0 5px ${color})` }}>
              {[0, 90, 180, 270].map((a) => (
                <path key={a} d="M-46,-30 V-46 H-30" fill="none" stroke={color} strokeWidth="3" transform={`rotate(${a})`} />
              ))}
              <g className="hud-spin-rev">
                <circle r="34" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="22 8 4 8" />
              </g>
              <g className={locked ? '' : 'hud-spin-fast'}>
                <circle r="24" fill="none" stroke={color} strokeOpacity="0.8" strokeWidth="2.5" strokeDasharray={locked ? '200 0' : '30 20'} />
              </g>
              {[0, 90, 180, 270].map((a) => (
                <line key={a} x1="0" y1="-18" x2="0" y2="-9" stroke={color} strokeWidth="2" transform={`rotate(${a})`} />
              ))}
            </svg>
            <div className="target-lock__tag" style={{ color, textShadow: `0 0 8px ${color}` }}>
              {locked ? 'TARGET LOCKED' : 'ACQUIRING'}
            </div>
          </div>
        )}
      </div>
    </Html>
  )
}
