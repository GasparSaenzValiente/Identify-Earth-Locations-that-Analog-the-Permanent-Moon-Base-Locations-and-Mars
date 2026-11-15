import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Quaternion, Vector3 } from 'three'
import { latLonToVector3 } from '../lib/geo'

const Z = new Vector3(0, 0, 1)

/** Expanding rings lying on a planet surface, used to mark the selected site on Mars and Earth. */
export default function SurfacePulse({ lat, lon, radius, size = 0.03, color = [0.6, 2.4, 3.2], rings = 3, speed = 0.7 }) {
  const refs = useRef([])
  const { position, quaternion } = useMemo(() => {
    const n = latLonToVector3(lat, lon, 1)
    return { position: n.clone().multiplyScalar(radius * 1.0025), quaternion: new Quaternion().setFromUnitVectors(Z, n) }
  }, [lat, lon, radius])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * speed
    refs.current.forEach((m, i) => {
      if (!m) return
      const k = (t + i / rings) % 1
      m.scale.setScalar(0.2 + k * 1.8)
      m.material.opacity = (1 - k) ** 1.5
    })
  })

  return (
    <group position={position} quaternion={quaternion}>
      {Array.from({ length: rings }, (_, i) => (
        <mesh key={i} ref={(m) => (refs.current[i] = m)} raycast={() => null} renderOrder={7}>
          <ringGeometry args={[size * 0.86, size, 64]} />
          <meshBasicMaterial color={color} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}
