import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useCursor } from '@react-three/drei'
import { Color, DoubleSide, MathUtils, Matrix4, Quaternion, Vector3 } from 'three'
import { EARTH_CENTER, EARTH_MARKERS, EARTH_RADIUS, EARTH_RADIUS_KM } from '../../config/scene'
import { angularDistanceRad, latLonToVector3, vector3ToLatLon } from '../../lib/geo'
import { clamp01, easeOutBack } from '../../lib/math'
import { pickNearest } from '../../services/andesDataService'
import { activeScoring, useMissionStore } from '../../store/useMissionStore'
import { IS_TOUCH, tapToSelect } from '../mars/GlacierMarkers'
import { scaleColor } from './andesColors'

const Z = new Vector3(0, 0, 1)
const _m = new Matrix4()
const _q = new Quaternion()
const _s = new Vector3()
const _p = new Vector3()
const _c = new Color()
const _v = new Vector3()
const _lastCamPos = new Vector3()
const _lastCamQuat = new Quaternion()
const HOT = new Color(3.4, 3.2, 3.0)
const SELECTED = new Color(3.6, 2.3, 0.9)
const TOP_N = 25
const RIPPLE_SECONDS = 1.9
const POP_SECONDS = 0.5
const RIPPLE_DEG = 26

/** Marker radius keeps a roughly constant on-screen size: proportional to camera altitude. */
function markerScale(camera, perAltitude) {
  const altitude = camera.position.distanceTo(EARTH_CENTER) - EARTH_RADIUS
  return MathUtils.clamp(altitude * perAltitude, EARTH_MARKERS.minScale, EARTH_MARKERS.maxScale)
}

/** Ripple-out reveal from the analog the camera lands on. */
function revealDelays(items, origin) {
  const out = new Float32Array(items.length)
  for (let i = 0; i < items.length; i++) {
    const deg = (angularDistanceRad(origin.lat, origin.lon, items[i].lat, items[i].lon) * 180) / Math.PI
    out[i] = clamp01(deg / RIPPLE_DEG) * RIPPLE_SECONDS
  }
  return out
}

function useRevealClock() {
  return useRef({ start: null, delays: null, done: false })
}

/* ── Inventory glaciers ─────────────────────────────────────────────────────────────────────── */
function GlacierField({ data }) {
  const mesh = useRef()
  const st = useRef({ zoom: 0, lastHover: -1, lastSelected: -1, dirty: true })
  const reveal = useRevealClock()
  const scoring = useMissionStore(activeScoring)
  const earthColor = useMissionStore((s) => s.earthColor)
  const visibleLayer = useMissionStore((s) => s.earthLayers.glaciers)
  const glaciers = data.glaciers

  const positions = useMemo(() => glaciers.map((g) => latLonToVector3(g.lat, g.lon, EARTH_RADIUS * EARTH_MARKERS.altitude)), [glaciers])
  const top = useMemo(() => new Set(scoring ? Array.from(scoring.order.subarray(0, TOP_N)) : []), [scoring])

  // Moderate luminance keeps the hue readable under bloom; the top ranks glow.
  const baseColor = (i, out) =>
    earthColor === 'absolute'
      ? scaleColor('absolute', glaciers[i].absolute, top.has(i) ? 1.6 : 0.85, out)
      : scaleColor('match', scoring.score[i], top.has(i) ? 1.6 : 0.85, out)

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m || !scoring) return
    for (let i = 0; i < glaciers.length; i++) m.setColorAt(i, baseColor(i, _c))
    m.instanceColor.needsUpdate = true
    st.current.lastHover = -1
    st.current.lastSelected = -1
    st.current.dirty = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoring, earthColor, glaciers, top])

  useFrame(({ camera, clock, events }) => {
    const m = mesh.current
    if (!m) return
    const s = useMissionStore.getState()
    const onEarth = s.activePlanet === 'earth' && !!s.selectedAnalog
    m.visible = onEarth && visibleLayer
    if (!onEarth) {
      reveal.current.start = null
      return
    }
    if (!m.visible) return
    const r = reveal.current
    if (r.start === null) {
      r.start = clock.elapsedTime
      r.delays = revealDelays(glaciers, s.selectedAnalog.analog)
      r.done = false
    }
    // Keep hover hit-testing live while the camera drifts under a still pointer.
    if (s.hovered && !IS_TOUCH && (!_lastCamPos.equals(camera.position) || !_lastCamQuat.equals(camera.quaternion))) events.update?.()
    _lastCamPos.copy(camera.position)
    _lastCamQuat.copy(camera.quaternion)

    const zoom = markerScale(camera, EARTH_MARKERS.glacierPerAltitude)
    const hoverIndex = s.hovered?.kind === 'andes' ? s.hovered.index : -1
    const selectedIndex = s.selectedAnalog.analogIndex
    const t = clock.elapsedTime - r.start
    const animating = !r.done
    const rescale = animating || st.current.dirty || Math.abs(zoom - st.current.zoom) / (st.current.zoom || 1) > 0.03
    const pulse = 1.9 + Math.sin(clock.elapsedTime * 5) * 0.4

    if (rescale) {
      st.current.zoom = zoom
      st.current.dirty = false
      let allIn = true
      for (let i = 0; i < glaciers.length; i++) {
        let k = 1
        if (animating) {
          const x = clamp01((t - r.delays[i]) / POP_SECONDS)
          if (x < 1) allIn = false
          k = x > 0 ? easeOutBack(x) : 0
        }
        const boost = i === selectedIndex ? pulse : i === hoverIndex ? 2.3 : top.has(i) ? 1.55 : 1
        _s.setScalar(zoom * k * boost)
        _m.makeScale(_s.x, _s.y, _s.z).setPosition(positions[i])
        m.setMatrixAt(i, _m)
      }
      if (animating && allIn) r.done = true
      m.instanceMatrix.clearUpdateRanges()
      m.instanceMatrix.needsUpdate = true
    } else if (selectedIndex >= 0) {
      _s.setScalar(zoom * pulse)
      _m.makeScale(_s.x, _s.y, _s.z).setPosition(positions[selectedIndex])
      m.setMatrixAt(selectedIndex, _m)
      m.instanceMatrix.clearUpdateRanges()
      m.instanceMatrix.addUpdateRange(selectedIndex * 16, 16)
      m.instanceMatrix.needsUpdate = true
    }

    // Hover / selection highlight (colour + one-off scale changes).
    const c = st.current
    if (hoverIndex !== c.lastHover || selectedIndex !== c.lastSelected) {
      for (const i of [c.lastHover, c.lastSelected]) if (i >= 0 && i !== hoverIndex && i !== selectedIndex) m.setColorAt(i, baseColor(i, _c))
      if (selectedIndex >= 0) m.setColorAt(selectedIndex, SELECTED)
      if (hoverIndex >= 0) m.setColorAt(hoverIndex, HOT)
      m.instanceColor.needsUpdate = true
      c.lastHover = hoverIndex
      c.lastSelected = selectedIndex
      c.dirty = true
    }
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, glaciers.length]} frustumCulled={false} renderOrder={4} raycast={() => null}>
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

/* ── Uniform survey grid ────────────────────────────────────────────────────────────────────── */
function SurveyField({ data }) {
  const mesh = useRef()
  const st = useRef({ zoom: 0, lastHover: -1, dirty: true })
  const reveal = useRevealClock()
  const visibleLayer = useMissionStore((s) => s.earthLayers.survey)
  const points = data.survey

  const frames = useMemo(
    () =>
      points.map((p) => {
        const n = latLonToVector3(p.lat, p.lon, 1)
        return { position: n.clone().multiplyScalar(EARTH_RADIUS * (EARTH_MARKERS.altitude - 0.0004)), quaternion: new Quaternion().setFromUnitVectors(Z, n) }
      }),
    [points],
  )
  const baseColor = (i, out) => {
    const p = points[i]
    if (p.thermal !== 0) return out.setRGB(0.12, 0.15, 0.18)
    return scaleColor('survey', p.absolute, 0.6, out)
  }

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    for (let i = 0; i < points.length; i++) m.setColorAt(i, baseColor(i, _c))
    m.instanceColor.needsUpdate = true
    st.current.lastHover = -1
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points])

  useFrame(({ camera, clock }) => {
    const m = mesh.current
    if (!m) return
    const s = useMissionStore.getState()
    const onEarth = s.activePlanet === 'earth' && !!s.selectedAnalog
    m.visible = onEarth && visibleLayer
    if (!onEarth) {
      reveal.current.start = null
      return
    }
    if (!m.visible) return
    const r = reveal.current
    if (r.start === null) {
      r.start = clock.elapsedTime + 0.25
      r.delays = revealDelays(points, s.selectedAnalog.analog)
      r.done = false
    }
    const zoom = markerScale(camera, EARTH_MARKERS.surveyPerAltitude)
    const hoverIndex = s.hovered?.kind === 'survey' ? s.hovered.index : -1
    const t = clock.elapsedTime - r.start
    const animating = !r.done
    if (animating || st.current.dirty || hoverIndex !== st.current.lastHover || Math.abs(zoom - st.current.zoom) / (st.current.zoom || 1) > 0.03) {
      st.current.zoom = zoom
      st.current.dirty = false
      let allIn = true
      for (let i = 0; i < points.length; i++) {
        let k = 1
        if (animating) {
          const x = clamp01((t - r.delays[i]) / POP_SECONDS)
          if (x < 1) allIn = false
          k = x > 0 ? easeOutBack(x) : 0
        }
        const inDomain = points[i].thermal === 0
        const boost = i === hoverIndex ? 1.9 : inDomain ? 1 : 0.7
        _s.setScalar(zoom * k * boost)
        m.setMatrixAt(i, _m.compose(frames[i].position, frames[i].quaternion, _s))
      }
      if (animating && allIn) r.done = true
      if (hoverIndex !== st.current.lastHover) {
        if (st.current.lastHover >= 0) m.setColorAt(st.current.lastHover, baseColor(st.current.lastHover, _c))
        if (hoverIndex >= 0) m.setColorAt(hoverIndex, HOT)
        m.instanceColor.needsUpdate = true
        st.current.lastHover = hoverIndex
      }
      m.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, points.length]} frustumCulled={false} renderOrder={3} raycast={() => null}>
      {/* hexagon outline: a survey grid cell, not a filled marker competing with the glaciers */}
      <ringGeometry args={[0.6, 1, 6]} />
      <meshBasicMaterial toneMapped={false} transparent opacity={0.75} depthWrite={false} side={DoubleSide} />
    </instancedMesh>
  )
}

/** Both Earth layers; they mount once a match (and therefore a scoring) exists. */
export default function AndesLayer() {
  const andes = useMissionStore((s) => s.andes)
  const hasMatch = useMissionStore((s) => !!s.selectedAnalog?.scorings)
  const phase = useMissionStore((s) => s.phase)
  const hovered = useMissionStore((s) => s.hovered)
  useCursor(phase === 'earth' && hovered?.kind === 'andes')
  if (andes.status !== 'ready' || !hasMatch) return null
  return (
    <>
      <SurveyField data={andes.data} />
      <GlacierField data={andes.data} />
    </>
  )
}

/**
 * Screen-space picking on the Earth globe: the hit point on the sphere is matched against a 0.5°
 * grid of glaciers / survey points within a fixed pixel radius. Much more forgiving than raycasting
 * 7,719 tiny instances, and independent of marker size.
 */
export function useEarthPicking() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  return useMemo(() => {
    const pick = (e) => {
      const st = useMissionStore.getState()
      if (st.phase !== 'earth' || st.andes.status !== 'ready' || !st.selectedAnalog) return undefined
      const data = st.andes.data
      _v.copy(e.point).sub(EARTH_CENTER)
      const { lat, lon } = vector3ToLatLon(_v)
      const dist = camera.position.distanceTo(_p.copy(e.point))
      const worldPerPx = (2 * dist * Math.tan(MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, size.height)
      const km = ((EARTH_MARKERS.pickPx * worldPerPx) / EARTH_RADIUS) * EARTH_RADIUS_KM
      if (st.earthLayers.glaciers) {
        const g = pickNearest(data.glacierGrid, data.glaciers, lat, lon, km)
        if (g) return g
      }
      if (st.earthLayers.survey) return pickNearest(data.surveyGrid, data.survey, lat, lon, km * 0.9)
      return null
    }
    return {
      onPointerOver: (e) => e.stopPropagation(),
      onPointerMove: (e) => {
        e.stopPropagation()
        const h = pick(e)
        if (h !== undefined && !IS_TOUCH) useMissionStore.getState().setHovered(h)
      },
      onPointerOut: () => {
        const st = useMissionStore.getState()
        if (!IS_TOUCH && (st.hovered?.kind === 'andes' || st.hovered?.kind === 'survey')) st.setHovered(null)
      },
      onClick: (e) => {
        e.stopPropagation()
        if (e.delta > 6) return
        const h = pick(e)
        if (h === undefined) return
        const st = useMissionStore.getState()
        if (!h) {
          if (IS_TOUCH) st.setHovered(null)
          return
        }
        if (h.kind === 'andes') tapToSelect(h, st.setHovered, (g) => st.selectEarthGlacier(g.index))
        else st.setHovered(h)
      },
    }
  }, [camera, size])
}
