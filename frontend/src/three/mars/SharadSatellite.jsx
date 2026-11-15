import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Line, useCursor } from '@react-three/drei'
import Html from '../SceneHtml'
import { AdditiveBlending, Color, DoubleSide, LatheGeometry, MathUtils, Vector2, Vector3 } from 'three'
import { MARS_RADIUS, SHARAD } from '../../config/scene'
import { isOccludedByPlanets } from '../../lib/occlusion'
import { useMissionStore } from '../../store/useMissionStore'
import { sharadState } from '../sharedState'

const TAU = Math.PI * 2

/** Orbit basis: a = ascending-node direction (equatorial plane), b = 90° along-track. */
function orbitBasis(inclinationDeg, nodeDeg) {
  const node = new Vector3(Math.cos(nodeDeg * MathUtils.DEG2RAD), 0, -Math.sin(nodeDeg * MathUtils.DEG2RAD))
  const normal = new Vector3(0, 1, 0).applyAxisAngle(node, inclinationDeg * MathUtils.DEG2RAD)
  const b = new Vector3().crossVectors(normal, node).normalize()
  return { a: node, b }
}

/** Parabolic high-gain antenna dish (MRO's 3 m HGA), opening towards -Z (away from Mars). */
function useDishGeometry() {
  return useMemo(() => {
    const pts = []
    for (let i = 0; i <= 12; i++) {
      const r = (i / 12) * 0.024
      pts.push(new Vector2(r, (r * r) / 0.05))
    }
    const g = new LatheGeometry(pts, 32)
    g.rotateX(Math.PI / 2) // lathe axis Y → +Z; dish bowl opens towards +Z…
    g.rotateY(Math.PI) // …flip so it opens towards -Z
    return g
  }, [])
}

const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
// Faint sounding beam: fades towards the surface, with radar pulses travelling down it.
// IMPORTANT: pow() with a negative base is NaN on real GPUs (AMD/D3D11 confirmed), and rounding can
// push `vUv.y` or `0.5 + 0.5*sin(x)` a hair below 0. One NaN pixel in the HDR buffer is smeared by
// the bloom over the whole screen → full black frame. Every pow() base is clamped.
const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float y = clamp(vUv.y, 0.0, 1.0);
    float body = pow(y, 1.4) * 0.35;
    float wave = clamp(0.5 + 0.5 * sin(y * 26.0 + uTime * 9.0), 0.0, 1.0);
    float pulses = pow(wave, 8.0) * 0.5;
    gl_FragColor = vec4(uColor, clamp((body + pulses * y) * uOpacity, 0.0, 1.0));
  }
`

const _pos = new Vector3()
const _vel = new Vector3()

/**
 * Mars Reconnaissance Orbiter carrying SHARAD (SHAllow RADar, ASI): a 10 m dipole sounding at
 * 15–25 MHz. Procedural low-poly model on an exaggerated near-polar orbit (MRO: i ≈ 92.6°).
 * Click it to run the radar sweep that loads the glacier-like-form inventory.
 */
export default function SharadSatellite() {
  const group = useRef()
  const model = useRef()
  const beacon = useRef()
  const label = useRef()
  const ring = useRef()
  const theta = useRef(0.6)
  const speed = useRef(1)
  const [hovered, setHovered] = useState(false)
  const [labelHovered, setLabelHovered] = useState(false)

  const phase = useMissionStore((s) => s.phase)
  const glfStatus = useMissionStore((s) => s.glf.status)
  const activateSharad = useMissionStore((s) => s.activateSharad)
  const clickable = phase === 'intro' && glfStatus !== 'loading'
  useCursor(hovered && clickable)

  const basis = useMemo(() => orbitBasis(SHARAD.inclinationDeg, SHARAD.nodeDeg), [])
  const orbitPoints = useMemo(() => {
    const pts = []
    for (let i = 0; i <= 256; i++) {
      const t = (i / 256) * TAU
      pts.push(basis.a.clone().multiplyScalar(Math.cos(t)).addScaledVector(basis.b, Math.sin(t)).multiplyScalar(SHARAD.orbitRadius))
    }
    return pts
  }, [basis])
  const dish = useDishGeometry()
  const beamLength = SHARAD.orbitRadius - MARS_RADIUS * 1.004
  const beamUniforms = useMemo(
    () => ({ uTime: { value: 0 }, uOpacity: { value: 0.3 }, uColor: { value: new Color(0.35, 1.3, 1.8) } }),
    [],
  )

  // Priority −2: move the orbiter before drei's <Html> (priority 0) projects its label, so the label
  // never trails the model by a frame.
  useFrame((state, dt) => {
    const g = group.current
    if (!g) return
    // The orbiter is a moving click target: it nearly stops while hovered so it is easy to hit.
    const aiming = (hovered || labelHovered) && clickable
    speed.current = MathUtils.damp(speed.current, aiming ? 0.03 : 1, 8, dt)
    theta.current = (theta.current + (speed.current * dt * TAU) / SHARAD.periodSec) % TAU
    const t = theta.current
    _pos.copy(basis.a).multiplyScalar(Math.cos(t)).addScaledVector(basis.b, Math.sin(t)).multiplyScalar(SHARAD.orbitRadius)
    _vel.copy(basis.a).multiplyScalar(-Math.sin(t)).addScaledVector(basis.b, Math.cos(t))
    g.position.copy(_pos)
    g.up.copy(_vel)
    g.lookAt(0, 0, 0) // +Z → nadir (group lives in the Mars frame, centred at the origin)

    sharadState.position.copy(_pos)
    let phi = Math.atan2(_pos.z, -_pos.x)
    if (phi < 0) phi += TAU
    sharadState.phi = phi

    const time = state.clock.elapsedTime
    const scanning = phase === 'scanning'
    // beamUniforms is the material's live uniforms object (passed through `args`, not copied).
    beamUniforms.uTime.value = time
    beamUniforms.uOpacity.value = MathUtils.damp(beamUniforms.uOpacity.value, scanning ? 0.9 : clickable ? 0.35 : 0.18, 4, dt)
    if (beacon.current) beacon.current.visible = Math.sin(time * 5) > 0.2
    if (model.current) {
      const s = MathUtils.damp(model.current.scale.x, hovered && clickable ? 1.22 : 1, 10, dt)
      model.current.scale.setScalar(s)
    }
    if (ring.current) {
      const k = (time * 0.8) % 1
      ring.current.scale.setScalar(clickable ? 1 + k * 1.6 : 0.0001)
      ring.current.material.opacity = clickable ? (1 - k) * 0.9 : 0
    }
    // Hide the HTML label (visually) while a planet is between the camera and the orbiter. It stays
    // focusable during the intro so keyboard users always have a stable tab stop.
    if (label.current) {
      const show = clickable && !isOccludedByPlanets(state.camera.position, _pos)
      label.current.style.opacity = show ? '1' : '0'
      label.current.style.pointerEvents = show ? 'auto' : 'none'
    }
  }, -2)

  useEffect(() => {
    if (!clickable) setHovered(false)
    const el = label.current
    if (!el) return
    el.toggleAttribute('inert', !clickable)
    el.setAttribute('aria-hidden', String(!clickable))
  }, [clickable])

  const onClick = (e) => {
    e.stopPropagation()
    if (e.delta > 6 || !clickable) return
    activateSharad()
  }

  return (
    <>
      <Line points={orbitPoints} color="#8fe9ff" lineWidth={1} dashed dashSize={0.04} gapSize={0.03} transparent opacity={0.28} depthWrite={false} />
      <group ref={group}>
        <group ref={model}>
          {/* bus */}
          <mesh>
            <boxGeometry args={[0.026, 0.026, 0.034]} />
            <meshStandardMaterial color="#d8b25c" metalness={0.75} roughness={0.32} />
          </mesh>
          {/* instrument deck (nadir side) */}
          <mesh position={[0, 0, 0.02]}>
            <boxGeometry args={[0.02, 0.018, 0.008]} />
            <meshStandardMaterial color="#3b3f48" metalness={0.4} roughness={0.5} />
          </mesh>
          {/* solar array booms + wings */}
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.016, 0, -0.004]}>
              <mesh position={[side * 0.012, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.0012, 0.0012, 0.024, 6]} />
                <meshStandardMaterial color="#9aa3ad" metalness={0.8} roughness={0.3} />
              </mesh>
              <mesh position={[side * 0.052, 0, 0]}>
                <boxGeometry args={[0.058, 0.036, 0.0016]} />
                <meshStandardMaterial color="#1a2d6e" emissive="#0b1a4d" emissiveIntensity={0.6} metalness={0.35} roughness={0.35} />
              </mesh>
            </group>
          ))}
          {/* high-gain antenna */}
          <mesh geometry={dish} position={[0, 0, -0.03]}>
            <meshStandardMaterial color="#ece8de" metalness={0.2} roughness={0.55} side={DoubleSide} />
          </mesh>
          {/* SHARAD 10 m dipole */}
          <mesh position={[0, -0.006, 0.026]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.0007, 0.0007, 0.13, 6]} />
            <meshStandardMaterial color="#d6dbe2" metalness={0.6} roughness={0.35} />
          </mesh>
          {/* blinking beacon */}
          <mesh ref={beacon} position={[0, 0.016, -0.01]}>
            <sphereGeometry args={[0.0026, 8, 8]} />
            <meshBasicMaterial color={[4, 0.9, 0.4]} toneMapped={false} />
          </mesh>
        </group>

        {/* radar footprint beam towards the surface (apex at the orbiter, uv.y = 1 there) */}
        <mesh position={[0, 0, beamLength / 2]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={3}>
          <coneGeometry args={[0.045, beamLength, 32, 1, true]} />
          <shaderMaterial
            args={[{ uniforms: beamUniforms, vertexShader: beamVertex, fragmentShader: beamFragment }]}
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
            side={DoubleSide}
          />
        </mesh>

        {/* "click me" pulse */}
        <Billboard>
          <mesh ref={ring} raycast={() => null}>
            <ringGeometry args={[0.07, 0.076, 48]} />
            <meshBasicMaterial color={[0.6, 2.2, 3]} transparent opacity={0.8} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        </Billboard>

        {/* Generous invisible hit target — the orbiter is small and moving. Handlers exist only
            while it is clickable; afterwards it must not swallow hovers/clicks on glaciers below. */}
        <mesh
          onClick={clickable ? onClick : undefined}
          onPointerOver={
            clickable
              ? (e) => {
                  e.stopPropagation()
                  setHovered(true)
                }
              : undefined
          }
          onPointerOut={clickable ? () => setHovered(false) : undefined}
        >
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        <Html position={[0, 0, 0]} zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          {/* The label doubles as a real (keyboard-focusable) button for Action 1. */}
          <button
            ref={label}
            type="button"
            className="sharad-label"
            onClick={() => clickable && activateSharad()}
            onPointerEnter={() => setLabelHovered(true)}
            onPointerLeave={() => setLabelHovered(false)}
            aria-label="Run the SHARAD radar sweep and load the glacier-like-form inventory"
          >
            <span className="sharad-label__dot" />
            <span className="text-left">
              <span className="sharad-label__title block">SHARAD · MRO</span>
              <span className="sharad-label__hint block">Run radar sweep ▸</span>
            </span>
          </button>
        </Html>
      </group>
    </>
  )
}
