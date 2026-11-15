import { useEffect } from 'react'
import { COLORS, MARS_CENTER, MARS_RADIUS } from '../../config/scene'
import { BASEMAPS } from '../../lib/tileTexture'
import { useMissionStore } from '../../store/useMissionStore'
import Atmosphere from '../Atmosphere'
import { Globe } from '../Globe'
import PlanetLabel from '../PlanetLabel'
import SurfacePulse from '../SurfacePulse'
import { useGlobeTexture } from '../useGlobeTexture'
import GlacierMarkers from './GlacierMarkers'
import GlacierTooltip from './GlacierTooltip'
import ReferenceSites from './ReferenceSites'
import ScanSweep from './ScanSweep'
import SharadSatellite from './SharadSatellite'
import TargetLock from './TargetLock'

/**
 * Scene 1 — Mars, the SHARAD orbiter and (after the sweep) the glacier-like-form inventory.
 * Everything lives in Mars' body frame, so lat/lon → Vector3 is all the placement math needed.
 */
export default function MarsScene() {
  const basemap = useMissionStore((s) => s.basemap)
  const glf = useMissionStore((s) => s.glf)
  const phase = useMissionStore((s) => s.phase)
  const referenceSites = useMissionStore((s) => s.referenceSites)
  const selected = useMissionStore((s) => s.selectedMarsSite)
  const setTextureSource = useMissionStore((s) => s.setTextureSource)

  const { texture, source } = useGlobeTexture(basemap === 'mola' ? BASEMAPS.marsMola : BASEMAPS.marsViking)
  useEffect(() => setTextureSource('mars', source), [source, setTextureSource])

  const scanned = glf.status === 'ready' && phase !== 'intro' && phase !== 'scanning'
  const showSelection = selected && ['matching', 'confirm', 'transit', 'mars', 'earth', 'returning'].includes(phase)

  return (
    <group position={MARS_CENTER}>
      <Globe radius={MARS_RADIUS}>
        <meshStandardMaterial map={texture} roughness={0.97} metalness={0} />
      </Globe>
      <Atmosphere radius={MARS_RADIUS} color={COLORS.marsHaze} haloScale={1.035} haloIntensity={0.7} rimIntensity={0.45} rimPower={3.8} />
      <SharadSatellite />
      <ScanSweep />
      {glf.status === 'ready' && <GlacierMarkers glaciers={glf.items} />}
      <ReferenceSites sites={referenceSites} scanned={scanned} />
      <GlacierTooltip />
      <TargetLock />
      {showSelection && (
        <SurfacePulse key={selected.id} lat={selected.lat} lon={selected.lon} radius={MARS_RADIUS} size={0.045} />
      )}
      <PlanetLabel name="Mars" subtitle="Glacier-like forms · Souness et al. 2012" radius={MARS_RADIUS} />
    </group>
  )
}
