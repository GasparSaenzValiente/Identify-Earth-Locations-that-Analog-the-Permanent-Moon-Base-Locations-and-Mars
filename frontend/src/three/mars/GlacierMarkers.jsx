import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useCursor } from '@react-three/drei'
import { Color, Matrix4, Quaternion, Vector3 } from 'three'
import { MARKERS, MARS_RADIUS, SCAN_END } from '../../config/scene'
import { latLonToVector3, lonToPhi } from '../../lib/geo'
import { clamp01, easeOutBack } from '../../lib/math'
import { useMissionStore } from '../../store/useMissionStore'
import { flightState, scanState } from '../sharedState'

const TAU = Math.PI * 2
const HDR = 1.35 // target luminance (> bloom threshold 1.0) so every marker glows a little

/**
 * Markers live in world space, so without help they look tiny from orbit and balloon when the
 * camera frames a glacier. This factor keeps their on-screen size roughly constant: 1 at the
 * default view (≈2.6 radii above the surface), shrinking when zoomed in.
 */
function zoomFactor(cameraDistanceFromCenter) {
  return Math.min(1.5, Math.max(0.3, (cameraDistanceFromCenter - MARS_RADIUS) / 2.6))
}

/** Marker radius grows with √area (km²) — a GLF's footprint — clamped to stay readable. */
export function markerScale(areaKm2) {
  const s = MARKERS.minScale + 0.0021 * Math.sqrt(Math.max(0, areaKm2 ?? 0))
  return Math.min(MARKERS.maxScale, s)
}

const ICE = new Color('#00ccff')
const ICE_WHITE = new Color('#e9fbff')
const ELEV_LOW = new Color('#5b6cff')
const ELEV_MID = new Color('#00ccff')
const ELEV_HIGH = new Color('#ffe08a')

export const COLOR_SCALES = {
  area: {
    label: 'Area (length × width) · log scale',
    minLabel: '≤0.2 km²',
    maxLabel: '≥60 km²',
    gradient: 'linear-gradient(90deg, #00ccff, #e9fbff)',
  },
  elevation: {
    label: 'Mean elevation (MOLA datum)',
    minLabel: '≤−6 km',
    maxLabel: '≥+6 km',
    gradient: 'linear-gradient(90deg, #5b6cff, #00ccff, #ffe08a)',
  },
}

export function colorForGlacier(g, mode, out = new Color()) {
  if (mode === 'elevation') {
    const t = clamp01(((g.elevation?.mean ?? 0) + 6000) / 12000)
    if (t < 0.5) out.copy(ELEV_LOW).lerp(ELEV_MID, t * 2)
    else out.copy(ELEV_MID).lerp(ELEV_HIGH, (t - 0.5) * 2)
  } else {
    const t = clamp01((Math.log10(Math.max(0.2, g.areaKm2 ?? 0.2)) + 0.7) / 2.48)
    out.copy(ICE).lerp(ICE_WHITE, t)
  }
  // Normalise to a fixed luminance so every marker (dark blue or pale gold) clears the bloom
  // threshold (1.0) by the same margin, instead of a fixed gain that leaves dim hues un-bloomed.
  const l = 0.2126 * out.r + 0.7152 * out.g + 0.0722 * out.b
  return out.multiplyScalar(HDR / Math.max(l, 1e-3))
}

const _m = new Matrix4()
const _c = new Color()
const _lastCamPos = new Vector3()
const _lastCamQuat = new Quaternion()
const WHITE_HOT = new Color(3.2, 3.2, 3.2)

/** Touch screens have no hover: first tap previews (tooltip), second tap on the same site flies. */
export const IS_TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches
const armed = { id: null }
export function tapToSelect(site, setHovered, select) {
  if (IS_TOUCH && armed.id !== site.id) {
    armed.id = site.id
    setHovered(site)
    return
  }
  armed.id = null
  select(site)
}

/**
 * All 1,309 glacier-like forms as one InstancedMesh (single draw call). Markers pop in as the
 * SHARAD sweep front passes their longitude, then react to hover / selection.
 */
export default function GlacierMarkers({ glaciers }) {
  const mesh = useRef()
  const state = useRef({ revealed: false, lastHover: -1, lastSelected: -1, boundsFresh: false, zoom: 1 })

  const phase = useMissionStore((s) => s.phase)
  const colorMode = useMissionStore((s) => s.colorMode)
  const hovered = useMissionStore((s) => s.hovered)
  const setHovered = useMissionStore((s) => s.setHovered)
  const selectMarsSite = useMissionStore((s) => s.selectMarsSite)
  const interactive = phase === 'mars'
  useCursor(interactive && hovered?.kind === 'glf')

  const data = useMemo(
    () =>
      glaciers.map((g) => ({
        position: latLonToVector3(g.lat, g.lon, MARS_RADIUS * MARKERS.altitude),
        scale: markerScale(g.areaKm2),
        phi: lonToPhi(g.lon),
      })),
    [glaciers],
  )

  const setInstance = (i, s) => {
    const d = data[i]
    const k = s * state.current.zoom
    _m.makeScale(k, k, k).setPosition(d.position)
    mesh.current.setMatrixAt(i, _m)
  }

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const revealedAlready = scanState.progress >= SCAN_END
    data.forEach((d, i) => setInstance(i, revealedAlready ? d.scale : 0))
    m.instanceMatrix.needsUpdate = true
    state.current.revealed = revealedAlready
    state.current.boundsFresh = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    glaciers.forEach((g, i) => m.setColorAt(i, colorForGlacier(g, colorMode, _c)))
    m.instanceColor.needsUpdate = true
    state.current.lastHover = -1 // force re-highlight with the new palette
  }, [glaciers, colorMode])

  useFrame(({ clock, camera, events }) => {
    const m = mesh.current
    if (!m) return
    const st = state.current
    const { hovered: h, selectedMarsSite, activePlanet } = useMissionStore.getState()

    // Nothing to draw or update while we are parked at Earth.
    m.visible = activePlanet === 'mars' || flightState.active
    if (!m.visible) return

    // The camera can move (damping, auto-moves) under a still pointer: re-run hit-testing so the
    // tooltip never sticks to a glacier that is no longer under the cursor.
    if (interactive && h && !IS_TOUCH) {
      if (!_lastCamPos.equals(camera.position) || !_lastCamQuat.equals(camera.quaternion)) events.update?.()
    }
    _lastCamPos.copy(camera.position)
    _lastCamQuat.copy(camera.quaternion)

    const valid = (i) => i >= 0 && i < data.length
    const hoverIndex = h?.kind === 'glf' && valid(h.index) ? h.index : -1
    const selectedIndex = selectedMarsSite?.kind === 'glf' && valid(selectedMarsSite.index) ? selectedMarsSite.index : -1
    let matricesDirty = false
    let colorsDirty = false

    // Re-scale every marker only when the zoom changed noticeably (keeps hit-testing exact too).
    const zoom = zoomFactor(camera.position.length())
    if (Math.abs(zoom - st.zoom) / st.zoom > 0.03) {
      st.zoom = zoom
      if (st.revealed) {
        for (let i = 0; i < data.length; i++) {
          const s = i === hoverIndex ? data[i].scale * 1.9 : data[i].scale
          setInstance(i, s)
        }
        matricesDirty = true
        st.boundsFresh = false
      }
    }

    if (!st.revealed) {
      const progress = scanState.progress
      for (let i = 0; i < data.length; i++) {
        const rel = (((data[i].phi - scanState.offset) % TAU) + TAU) % TAU
        const k = clamp01((progress - rel) / 0.45)
        setInstance(i, data[i].scale * (k > 0 ? easeOutBack(k) : 0))
      }
      matricesDirty = true
      if (progress >= SCAN_END) st.revealed = true
    }

    if (st.revealed && !st.boundsFresh) {
      m.computeBoundingSphere() // instance bounds changed — keep raycasting exact
      st.boundsFresh = true
    }

    if (hoverIndex !== st.lastHover) {
      if (st.lastHover >= 0 && st.lastHover < data.length) {
        if (st.revealed && st.lastHover !== selectedIndex) setInstance(st.lastHover, data[st.lastHover].scale)
        m.setColorAt(st.lastHover, colorForGlacier(glaciers[st.lastHover], colorMode, _c))
      }
      if (hoverIndex >= 0) {
        setInstance(hoverIndex, data[hoverIndex].scale * 1.9)
        m.setColorAt(hoverIndex, WHITE_HOT)
      }
      st.lastHover = hoverIndex
      matricesDirty = colorsDirty = true
    }

    if (selectedIndex !== st.lastSelected) {
      if (valid(st.lastSelected) && st.lastSelected !== hoverIndex) {
        setInstance(st.lastSelected, data[st.lastSelected].scale)
        m.setColorAt(st.lastSelected, colorForGlacier(glaciers[st.lastSelected], colorMode, _c))
      }
      if (selectedIndex >= 0) m.setColorAt(selectedIndex, WHITE_HOT)
      st.lastSelected = selectedIndex
      matricesDirty = colorsDirty = true
    }

    // Upload the full buffers only when something besides the selection pulse changed.
    const attr = m.instanceMatrix
    if (matricesDirty) {
      attr.clearUpdateRanges()
      attr.needsUpdate = true
    }
    if (colorsDirty) {
      m.instanceColor.clearUpdateRanges()
      m.instanceColor.needsUpdate = true
    }
    if (selectedIndex >= 0 && st.revealed) {
      const pulse = 1.7 + Math.sin(clock.elapsedTime * 6) * 0.35
      setInstance(selectedIndex, data[selectedIndex].scale * pulse)
      if (!matricesDirty) {
        attr.clearUpdateRanges()
        attr.addUpdateRange(selectedIndex * 16, 16)
      }
      attr.needsUpdate = true
    }
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, glaciers.length]}
      frustumCulled={false}
      onPointerMove={
        interactive
          ? (e) => {
              e.stopPropagation()
              const g = glaciers[e.instanceId]
              if (g) setHovered(g)
            }
          : undefined
      }
      onPointerOut={interactive && !IS_TOUCH ? () => setHovered(null) : undefined}
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation()
              if (e.delta > 6) return
              const g = glaciers[e.instanceId]
              if (g) tapToSelect(g, setHovered, selectMarsSite)
            }
          : undefined
      }
    >
      <icosahedronGeometry args={[1, 1]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}
