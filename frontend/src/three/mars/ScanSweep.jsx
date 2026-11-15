import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import gsap from 'gsap'
import { AdditiveBlending, Color } from 'three'
import { MARS_RADIUS, SCAN_DURATION, SCAN_END } from '../../config/scene'
import { useMissionStore } from '../../store/useMissionStore'
import { scanState, sharadState } from '../sharedState'

const vertexShader = /* glsl */ `
  varying vec3 vObj;
  void main() {
    vObj = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// A glowing radar front sweeps eastwards around the planet starting under the orbiter, leaving a
// fading lat/lon grid behind it. Azimuth convention matches lonToPhi(): phi = atan(z, -x).
const fragmentShader = /* glsl */ `
  uniform float uProgress;
  uniform float uOffset;
  uniform float uActive;
  uniform vec3 uColor;
  varying vec3 vObj;
  const float TAU = 6.28318530718;
  void main() {
    vec3 n = normalize(vObj);
    // atan(0, 0) is undefined (NaN on some GPUs) exactly at the poles — guard it.
    float phi = abs(n.x) + abs(n.z) < 1e-6 ? 0.0 : atan(n.z, -n.x);
    if (phi < 0.0) phi += TAU;
    float rel = mod(phi - uOffset + TAU, TAU);
    float behind = uProgress - rel;
    float front = exp(-abs(behind) * 38.0);
    float trail = behind > 0.0 ? exp(-behind * 2.4) * 0.28 : 0.0;
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float gridLat = smoothstep(0.985, 1.0, abs(cos(lat * 18.0)));
    float gridLon = smoothstep(0.985, 1.0, abs(cos(phi * 18.0)));
    float grid = behind > 0.0 ? max(gridLat, gridLon) * 0.35 * exp(-behind * 1.1) : 0.0;
    float polar = 1.0 - smoothstep(0.82, 0.98, abs(n.y));
    float a = (front + trail + grid) * uActive * polar;
    gl_FragColor = vec4(uColor, a);
  }
`

export default function ScanSweep() {
  const material = useRef()
  const phase = useMissionStore((s) => s.phase)
  const status = useMissionStore((s) => s.glf.status)

  const uniforms = useMemo(
    () => ({
      uProgress: { value: 0 },
      uOffset: { value: 0 },
      uActive: { value: 0 },
      uColor: { value: new Color(0.35, 1.9, 2.6) },
    }),
    [],
  )

  useEffect(() => {
    if (phase !== 'scanning' || status !== 'ready') return undefined
    scanState.offset = sharadState.phi
    scanState.progress = 0
    scanState.active = 0
    const tl = gsap.timeline({ onComplete: () => useMissionStore.getState().finishScan() })
    tl.to(scanState, { active: 1, duration: 0.35, ease: 'power2.out' }, 0)
    tl.to(scanState, { progress: SCAN_END, duration: SCAN_DURATION, ease: 'power1.inOut' }, 0)
    tl.to(scanState, { active: 0, duration: 0.9, ease: 'power2.in' }, SCAN_DURATION - 0.6)
    return () => tl.kill()
  }, [phase, status])

  useFrame(() => {
    uniforms.uProgress.value = scanState.progress
    uniforms.uOffset.value = scanState.offset
    uniforms.uActive.value = scanState.active
    if (material.current) material.current.visible = scanState.active > 0.001
  })

  return (
    <mesh scale={MARS_RADIUS * 1.006} renderOrder={4} raycast={() => null}>
      <sphereGeometry args={[1, 128, 64]} />
      {/* Uniforms go through `args` (by reference): R3F's `uniforms` prop copies each uniform, so
          per-frame writes to the memo object would never reach the material. */}
      <shaderMaterial
        ref={material}
        args={[{ uniforms, vertexShader, fragmentShader }]}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  )
}
