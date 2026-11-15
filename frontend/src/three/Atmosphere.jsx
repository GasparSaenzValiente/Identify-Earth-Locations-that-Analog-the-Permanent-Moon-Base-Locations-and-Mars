import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BackSide, Color, FrontSide, MathUtils, Vector3 } from 'three'

// normalize() of a ~zero vector is NaN in GLSL; a single NaN pixel in the HDR buffer is smeared
// over the whole screen by the bloom blur (→ black frame). Guard every normalisation.
const SAFE_NORMALIZE = /* glsl */ `
  vec3 safeNormalize(vec3 v, vec3 fallback) {
    float l = length(v);
    return l > 1e-6 ? v / l : fallback;
  }
`

const vertexShader = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vPosV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vPosV = mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`

// Outer halo, rendered on the back faces of a slightly larger shell. x = 0 at the shell's limb and
// grows towards the planet's limb (x = uInner), so the glow hugs the planet and fades into space.
const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uInner;
  varying vec3 vNormalV;
  varying vec3 vPosV;
  ${SAFE_NORMALIZE}
  void main() {
    vec3 v = safeNormalize(-vPosV, vec3(0.0, 0.0, 1.0));
    float x = -dot(safeNormalize(vNormalV, -v), v);
    float a = smoothstep(0.0, uInner, x);
    a = pow(clamp(a, 0.0, 1.0), 2.4);
    gl_FragColor = vec4(uColor * uIntensity, a);
  }
`

// Fresnel haze over the planet disc, strongest at the limb.
const rimFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPower;
  varying vec3 vNormalV;
  varying vec3 vPosV;
  ${SAFE_NORMALIZE}
  void main() {
    vec3 v = safeNormalize(-vPosV, vec3(0.0, 0.0, 1.0));
    float f = 1.0 - clamp(dot(safeNormalize(vNormalV, v), v), 0.0, 1.0);
    gl_FragColor = vec4(uColor * uIntensity, pow(clamp(f, 0.0, 1.0), uPower));
  }
`

const _w = new Vector3()

export default function Atmosphere({ radius, color, haloScale = 1.05, haloIntensity = 1.2, rimIntensity = 0.8, rimPower = 3.2 }) {
  const group = useRef()
  // From far away the planet is a small disc: brighten the halo so it reads as a glowing target
  // (it is the destination on screen for most of a flight).
  useFrame(({ camera }) => {
    if (!group.current) return
    group.current.getWorldPosition(_w)
    const d = camera.position.distanceTo(_w) / radius
    halo.uIntensity.value = haloIntensity * (1 + 2.2 * MathUtils.smoothstep(d, 6, 26))
  })
  const halo = useMemo(
    () => ({
      uColor: { value: new Color(color) },
      uIntensity: { value: haloIntensity },
      uInner: { value: Math.sqrt(1 - 1 / (haloScale * haloScale)) },
    }),
    [color, haloIntensity, haloScale],
  )
  const rim = useMemo(
    () => ({ uColor: { value: new Color(color) }, uIntensity: { value: rimIntensity }, uPower: { value: rimPower } }),
    [color, rimIntensity, rimPower],
  )
  return (
    <group ref={group}>
      <mesh scale={radius * 1.002} renderOrder={5} raycast={() => null}>
        <sphereGeometry args={[1, 96, 48]} />
        <shaderMaterial
          args={[{ uniforms: rim, vertexShader, fragmentShader: rimFragment }]}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          side={FrontSide}
        />
      </mesh>
      <mesh scale={radius * haloScale} renderOrder={6} raycast={() => null}>
        <sphereGeometry args={[1, 96, 48]} />
        <shaderMaterial
          args={[{ uniforms: halo, vertexShader, fragmentShader: haloFragment }]}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          side={BackSide}
        />
      </mesh>
    </group>
  )
}
