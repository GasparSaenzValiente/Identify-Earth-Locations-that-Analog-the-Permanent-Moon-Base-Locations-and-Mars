import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BackSide, Vector3 } from 'three'

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pinned to the far plane: always behind everything
  }
`

// Dim procedural sky: a Milky Way band with dust lanes plus faint coloured nebulae, so empty space
// never reads as a black screen during the cruise. Values are linear and stay well below the bloom
// threshold (1.0).
const fragmentShader = /* glsl */ `
  uniform vec3 uBand;
  varying vec3 vDir;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float b = dot(d, uBand);
    float band = exp(-b * b / 0.03);
    float n = fbm(d * 3.0);
    float m = fbm(d * 5.0 + 7.3);
    float dust = smoothstep(0.5, 0.78, fbm(d * 9.0 + 2.0));
    vec3 base = vec3(0.006, 0.008, 0.018);
    vec3 milky = band * (0.03 + 0.08 * n) * (1.0 - 0.65 * dust) * vec3(0.62, 0.66, 0.9);
    vec3 nebula = pow(clamp(m, 0.0, 1.0), 3.2) * 0.12 * mix(vec3(0.5, 0.18, 0.6), vec3(0.08, 0.36, 0.6), n);
    gl_FragColor = vec4(base + milky + nebula, 1.0);
  }
`

/** Sky sphere that follows the camera (no parallax) and renders behind everything. */
export default function SpaceBackdrop() {
  const mesh = useRef()
  const uniforms = useMemo(() => ({ uBand: { value: new Vector3(0.25, 0.9, -0.35).normalize() } }), [])
  useFrame(({ camera }) => {
    mesh.current?.position.copy(camera.position)
  })
  return (
    <mesh ref={mesh} renderOrder={-10} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[100, 64, 32]} />
      <shaderMaterial args={[{ uniforms, vertexShader, fragmentShader }]} side={BackSide} depthWrite={false} />
    </mesh>
  )
}
