import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { Bloom, ChromaticAberration, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { MathUtils, Vector2, Vector3 } from 'three'
import { CONTROLS, EARTH_CENTER, LIGHTING, MARS_CENTER, PLANETS } from '../config/scene'
import { vector3ToLatLon } from '../lib/geo'
import { useMissionStore } from '../store/useMissionStore'
import CameraDirector from './CameraDirector'
import SpaceBackdrop from './SpaceBackdrop'
import EarthScene from './earth/EarthScene'
import MarsScene from './mars/MarsScene'
import { flightState, viewState } from './sharedState'
import WarpStreaks from './WarpStreaks'

const _dir = new Vector3()
const _right = new Vector3()
const _up = new Vector3()

const MARS_EARTH = EARTH_CENTER.distanceTo(MARS_CENTER)

/**
 * A "sun" that always lights the hemisphere the camera is looking at, from slightly up-and-right,
 * so both planets show a readable terminator without ever presenting a dark side to the user.
 * Its intensity follows the planet in focus (Earth's basemap is much darker than Mars').
 */
function SunLight() {
  const light = useRef()
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    const l = light.current
    if (!l) return
    const center = flightState.focusCenter
    _dir.copy(camera.position).sub(center).normalize()
    _right.setFromMatrixColumn(camera.matrixWorld, 0)
    _up.setFromMatrixColumn(camera.matrixWorld, 1)
    _dir.addScaledVector(_right, 0.9).addScaledVector(_up, 0.55).normalize()
    l.position.copy(center).addScaledVector(_dir, 60)
    l.target.position.copy(center)
    l.target.updateMatrixWorld()
    const w = MathUtils.clamp(center.distanceTo(MARS_CENTER) / MARS_EARTH, 0, 1)
    l.intensity = MathUtils.lerp(LIGHTING.marsSun, LIGHTING.earthSun, w)
  })
  return <directionalLight ref={light} intensity={LIGHTING.marsSun} color="#fff3e2" />
}

function Effects() {
  const aberration = useRef()
  const offset = useMemo(() => new Vector2(0.0002, 0.0001), [])
  useFrame(() => {
    const w = flightState.warp
    aberration.current?.offset.set(0.0002 + 0.0022 * w, 0.0001 + 0.0014 * w)
  })
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.85} radius={0.72} />
      <ChromaticAberration ref={aberration} offset={offset} radialModulation modulationOffset={0.2} />
      <Vignette offset={0.3} darkness={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}

/**
 * On phones the analog panel is a bottom sheet over the lower ~half of the screen, while the camera
 * centres the analog. Shift the projection (not the camera) so the site sits in the upper third.
 */
function PhoneViewOffset() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const phase = useMissionStore((s) => s.phase)
  const earthPanelOpen = useMissionStore((s) => s.earthPanelOpen)
  const current = useRef({ x: 0, y: 0 })
  useFrame((_, dt) => {
    let tx = 0
    let ty = 0
    if (phase === 'earth') {
      if (size.width < 640) ty = 0.22
      else {
        // centre the analog in the free column between the Earth panel (340 px, when open) and the
        // comparison panel (400 px) instead of the middle of the screen
        const leftOpen = earthPanelOpen ?? size.width >= 1180
        const left = leftOpen ? 356 : 0
        const right = size.width - 416
        tx = (size.width / 2 - (left + right) / 2) / size.width
      }
    }
    const c = current.current
    const nx = MathUtils.damp(c.x, tx, 5, dt)
    const ny = MathUtils.damp(c.y, ty, 5, dt)
    const settled = Math.abs(nx - tx) < 1e-4 && Math.abs(ny - ty) < 1e-4
    if (settled && Math.abs(c.x - tx) < 1e-4 && Math.abs(c.y - ty) < 1e-4) {
      if (tx === 0 && ty === 0 && camera.view?.enabled) camera.clearViewOffset()
      c.x = tx
      c.y = ty
      return
    }
    c.x = nx
    c.y = ny
    if (Math.abs(nx) < 1e-3 && Math.abs(ny) < 1e-3) camera.clearViewOffset()
    else camera.setViewOffset(size.width, size.height, size.width * nx, size.height * ny, size.width, size.height)
  })
  return null
}

const _rel = new Vector3()

/** Camera telemetry for the HUD: sub-camera lat/lon and altitude over the nearest planet. */
function ViewTelemetry() {
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    const dMars = camera.position.distanceTo(PLANETS.mars.center) / PLANETS.mars.radius
    const dEarth = camera.position.distanceTo(PLANETS.earth.center) / PLANETS.earth.radius
    const p = dMars <= dEarth ? PLANETS.mars : PLANETS.earth
    _rel.copy(camera.position).sub(p.center)
    const { lat, lon } = vector3ToLatLon(_rel)
    viewState.planet = p.key
    viewState.lat = lat
    viewState.lon = lon
    viewState.altitudeKm = (_rel.length() / p.radius - 1) * p.radiusKm
  })
  return null
}

/** Dev-only: expose the R3F store getter for console debugging / automated checks. */
function DevHandle() {
  const get = useThree((s) => s.get)
  useEffect(() => {
    if (import.meta.env.DEV) window.__three = get
  }, [get])
  return null
}

export default function Experience() {
  return (
    <>
      {import.meta.env.DEV && <DevHandle />}
      <PhoneViewOffset />
      <ViewTelemetry />
      <color attach="background" args={['#010206']} />
      <ambientLight intensity={0.09} />
      <SunLight />
      <SpaceBackdrop />
      <Stars radius={200} depth={90} count={9000} factor={5} saturation={0.12} fade speed={0.35} />

      <MarsScene />
      <EarthScene />
      <WarpStreaks />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.55}
        zoomSpeed={0.8}
        panSpeed={0.6}
        autoRotateSpeed={0.35}
        minPolarAngle={0.05}
        maxPolarAngle={Math.PI - 0.05}
        minDistance={CONTROLS.mars.min}
        maxDistance={CONTROLS.mars.max}
      />
      <CameraDirector />
      <Effects />
    </>
  )
}
