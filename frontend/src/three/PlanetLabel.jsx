import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { isOccludedByPlanets } from '../lib/occlusion'
import Html from './SceneHtml'

const _w = new Vector3()

/** Name tag that fades in only when the planet is far away (e.g. Earth seen from Mars, mid-flight). */
export default function PlanetLabel({ name, subtitle, radius, showBeyond = 14 }) {
  const anchor = useRef()
  const el = useRef()
  useFrame(({ camera }) => {
    if (!anchor.current || !el.current) return
    anchor.current.getWorldPosition(_w)
    const d = camera.position.distanceTo(_w) / radius
    let o = Math.min(1, Math.max(0, (d - showBeyond) / 6))
    if (o > 0) {
      _w.y += radius * 1.35 // label anchor
      if (isOccludedByPlanets(camera.position, _w)) o = 0
    }
    el.current.style.opacity = String(o)
  })
  return (
    <group ref={anchor}>
      <Html position={[0, radius * 1.35, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={el} className="planet-label" style={{ opacity: 0 }} aria-hidden="true">
          <div className="planet-label__name">{name}</div>
          {subtitle && <div className="planet-label__sub">{subtitle}</div>}
        </div>
      </Html>
    </group>
  )
}
