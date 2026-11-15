import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { NoColorSpace } from 'three'
import { COLORS, EARTH_CENTER, EARTH_RADIUS, LIGHTING } from '../../config/scene'
import { smoothstep } from '../../lib/math'
import { BASEMAPS, EARTH_EXTRAS } from '../../lib/tileTexture'
import { useMissionStore } from '../../store/useMissionStore'
import Atmosphere from '../Atmosphere'
import { Globe } from '../Globe'
import PlanetLabel from '../PlanetLabel'
import { useGlobeTexture, useOptionalTexture } from '../useGlobeTexture'
import AnalogSites from './AnalogSites'
import AndesLayer, { useEarthPicking } from './AndesLayer'
import DetailPatch from './DetailPatch'
import EarthTooltip from './EarthTooltip'

function Clouds({ texture }) {
  const mesh = useRef()
  useFrame(({ camera }, dt) => {
    const m = mesh.current
    if (!m) return
    m.rotation.y += dt * 0.006
    // Clear the view when zoomed in on an analog; full cover from orbit.
    const d = camera.position.distanceTo(EARTH_CENTER) / EARTH_RADIUS
    m.material.opacity = 0.55 * smoothstep(1.3, 2.3, d)
    m.visible = m.material.opacity > 0.01
  })
  return (
    <mesh ref={mesh} scale={EARTH_RADIUS * 1.008} renderOrder={2} raycast={() => null}>
      <sphereGeometry args={[1, 128, 64]} />
      <meshPhongMaterial map={texture} transparent opacity={0.55} depthWrite={false} shininess={0} />
    </mesh>
  )
}

/** Scene 2 — Earth with NASA Blue Marble, clouds, atmosphere and the Andean analogs. */
export default function EarthScene() {
  const { texture, source } = useGlobeTexture(BASEMAPS.earthBlueMarble)
  const clouds = useOptionalTexture(EARTH_EXTRAS.clouds)
  const specular = useOptionalTexture(EARTH_EXTRAS.specular, { colorSpace: NoColorSpace })
  const match = useMissionStore((s) => s.selectedAnalog)
  const setTextureSource = useMissionStore((s) => s.setTextureSource)
  useEffect(() => setTextureSource('earth', source), [source, setTextureSource])
  const picking = useEarthPicking()

  return (
    <group position={EARTH_CENTER}>
      <Globe radius={EARTH_RADIUS} {...picking}>
        <meshPhongMaterial
          key={specular ? 'specular' : 'matte'}
          map={texture}
          emissive="#ffffff"
          emissiveMap={texture}
          emissiveIntensity={LIGHTING.earthFill}
          specularMap={specular ?? null}
          specular={specular ? '#4a5a6a' : '#111111'}
          shininess={specular ? 22 : 4}
        />
      </Globe>
      {match && <DetailPatch key={match.analog.id} lat={match.analog.lat} lon={match.analog.lon} radius={EARTH_RADIUS} />}
      {clouds && <Clouds texture={clouds} />}
      <Atmosphere radius={EARTH_RADIUS} color={COLORS.earthHaze} haloScale={1.06} haloIntensity={1.35} rimIntensity={0.9} rimPower={3.0} />
      <AndesLayer />
      <AnalogSites />
      <EarthTooltip />
      <PlanetLabel name="Earth" subtitle="Andean glacier inventory" radius={EARTH_RADIUS} />
    </group>
  )
}
