import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { AdditiveBlending, BufferAttribute, BufferGeometry } from 'three'
import { flightState } from './sharedState'

const COUNT = 900
const DEPTH = 80

/**
 * Hyperspace streaks: line segments in a tube around the view axis that rush towards the camera
 * and stretch with flight speed (flightState.warp). Rebuilt in camera space every frame.
 */
export default function WarpStreaks() {
  const camera = useThree((s) => s.camera)
  const lines = useRef()
  const material = useRef()

  const { geometry, seeds } = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(COUNT * 6), 3))
    const s = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 1.2 + Math.random() * 16
      s[i * 3] = Math.cos(a) * r
      s[i * 3 + 1] = Math.sin(a) * r
      s[i * 3 + 2] = -1 - Math.random() * DEPTH
    }
    return { geometry: g, seeds: s }
  }, [])

  useFrame((_, dt) => {
    const w = flightState.warp
    const obj = lines.current
    if (!obj) return
    obj.visible = w > 0.01
    if (!obj.visible) return
    obj.position.copy(camera.position)
    obj.quaternion.copy(camera.quaternion)
    const pos = geometry.attributes.position.array
    const speed = 30 + 170 * w
    const len = 0.4 + 11 * w
    for (let i = 0; i < COUNT; i++) {
      let z = seeds[i * 3 + 2] + speed * dt
      if (z > -1) z -= DEPTH
      seeds[i * 3 + 2] = z
      const x = seeds[i * 3]
      const y = seeds[i * 3 + 1]
      pos[i * 6] = x
      pos[i * 6 + 1] = y
      pos[i * 6 + 2] = z
      pos[i * 6 + 3] = x
      pos[i * 6 + 4] = y
      pos[i * 6 + 5] = z - len
    }
    geometry.attributes.position.needsUpdate = true
    if (material.current) material.current.opacity = Math.min(1, w * 1.1)
  })

  return (
    <lineSegments ref={lines} geometry={geometry} frustumCulled={false} renderOrder={9} raycast={() => null}>
      <lineBasicMaterial ref={material} color={[1.1, 1.6, 2.4]} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
    </lineSegments>
  )
}
