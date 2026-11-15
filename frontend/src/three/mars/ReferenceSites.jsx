import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useCursor } from '@react-three/drei'
import Html from '../SceneHtml'
import { AdditiveBlending, Quaternion, Vector3 } from 'three'
import { MARS_RADIUS } from '../../config/scene'
import { latLonToVector3 } from '../../lib/geo'
import { useMissionStore } from '../../store/useMissionStore'
import { IS_TOUCH, tapToSelect } from './GlacierMarkers'

const Z = new Vector3(0, 0, 1)
const _n = new Vector3()
const _cam = new Vector3()

/**
 * The mock mapping's reference glaciers (m1, m2) — the sites the mock analog dictionary is keyed
 * on. Rendered as amber diamonds with always-on labels so they are easy to find.
 */
function ReferenceSite({ site, interactive, scanned }) {
  const group = useRef()
  const diamond = useRef()
  const halo = useRef()
  const label = useRef()
  const setHovered = useMissionStore((s) => s.setHovered)
  const selectMarsSite = useMissionStore((s) => s.selectMarsSite)
  const isHovered = useMissionStore((s) => s.hovered?.id === site.id)
  const isSelected = useMissionStore((s) => s.selectedMarsSite?.id === site.id)

  const { position, quaternion, normal } = useMemo(() => {
    const n = latLonToVector3(site.lat, site.lon, 1)
    return {
      normal: n,
      position: n.clone().multiplyScalar(MARS_RADIUS * 1.004),
      quaternion: new Quaternion().setFromUnitVectors(Z, n),
    }
  }, [site])

  useFrame(({ clock, camera }, dt) => {
    const t = clock.elapsedTime
    if (group.current) {
      const target = scanned ? 1 : 0
      const s = group.current.scale.x + (target - group.current.scale.x) * Math.min(1, dt * 4)
      group.current.scale.setScalar(Math.max(0.0001, s))
    }
    if (diamond.current) {
      diamond.current.rotation.z = t * 1.2
      const k = isHovered || isSelected ? 1.45 : 1
      diamond.current.scale.setScalar(k * (isSelected ? 1 + Math.sin(t * 6) * 0.12 : 1))
    }
    if (halo.current) {
      const k = (t * 0.6) % 1
      halo.current.scale.setScalar(1 + k * 2.2)
      halo.current.material.opacity = (1 - k) * 0.85
    }
    if (label.current) {
      _n.copy(normal)
      _cam.copy(camera.position).normalize()
      const facing = _n.dot(_cam)
      label.current.style.opacity = scanned && facing > 0.25 ? String(Math.min(1, (facing - 0.25) * 4)) : '0'
    }
  })

  return (
    <group ref={group} position={position} quaternion={quaternion} scale={0.0001}>
      <mesh
        ref={diamond}
        position={[0, 0, 0.012]}
        onPointerMove={
          interactive
            ? (e) => {
                e.stopPropagation()
                setHovered(site)
              }
            : undefined
        }
        onPointerOut={interactive && !IS_TOUCH ? () => setHovered(null) : undefined}
        onClick={
          interactive
            ? (e) => {
                e.stopPropagation()
                if (e.delta > 6) return
                tapToSelect(site, setHovered, selectMarsSite)
              }
            : undefined
        }
      >
        <octahedronGeometry args={[0.018, 0]} />
        <meshBasicMaterial color={[3.2, 1.7, 0.45]} toneMapped={false} />
      </mesh>
      <mesh ref={halo} raycast={() => null}>
        <ringGeometry args={[0.02, 0.024, 48]} />
        <meshBasicMaterial color={[3, 1.6, 0.4]} transparent opacity={0.8} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <Html position={[0, 0, 0.045]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={label} className="ref-label" style={{ opacity: 0 }} aria-hidden="true">
          <span className="ref-label__diamond" />
          {site.name}
        </div>
      </Html>
    </group>
  )
}

export default function ReferenceSites({ sites, scanned }) {
  const phase = useMissionStore((s) => s.phase)
  const hoveredKind = useMissionStore((s) => s.hovered?.kind)
  const interactive = phase === 'mars'
  useCursor(interactive && hoveredKind === 'reference')
  return sites.map((site) => <ReferenceSite key={site.id} site={site} interactive={interactive} scanned={scanned} />)
}
