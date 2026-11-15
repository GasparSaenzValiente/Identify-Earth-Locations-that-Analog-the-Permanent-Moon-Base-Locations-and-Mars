import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import Html from '../SceneHtml'
import { AdditiveBlending, Color, Quaternion, Vector3 } from 'three'
import { EARTH_RADIUS } from '../../config/scene'
import { bestIces, pct } from '../../lib/analogScoring'
import { latLonToVector3 } from '../../lib/geo'
import { isOccludedByPlanets } from '../../lib/occlusion'
import { Reticle } from '../../ui/hud/HudRing'
import { activeScoring, useMissionStore } from '../../store/useMissionStore'
import SurfacePulse from '../SurfacePulse'

const Y = new Vector3(0, 1, 0)

const beamVertex = /* glsl */ `
  varying float vH;
  void main() {
    vH = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying float vH;
  void main() {
    float fade = pow(clamp(1.0 - vH, 0.0, 1.0), 1.6); // clamp: pow(negative) is NaN on real GPUs
    float pulse = 0.75 + 0.25 * sin(uTime * 4.0 - vH * 12.0);
    gl_FragColor = vec4(uColor, fade * pulse * uOpacity);
  }
`

/** Light pillar rising from the selected analog + expanding surface rings. */
function Beacon({ analog, active }) {
  const { position, quaternion } = useMemo(() => {
    const n = latLonToVector3(analog.lat, analog.lon, 1)
    return { position: n.clone().multiplyScalar(EARTH_RADIUS), quaternion: new Quaternion().setFromUnitVectors(Y, n) }
  }, [analog])
  const uniforms = useMemo(
    () => ({ uColor: { value: new Color(3.0, 1.7, 0.5) }, uTime: { value: 0 }, uOpacity: { value: 0 } }),
    [],
  )
  const height = 0.32
  useFrame(({ clock }, dt) => {
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uOpacity.value += ((active ? 1 : 0) - uniforms.uOpacity.value) * Math.min(1, dt * 2)
  })
  return (
    <group>
      <group position={position} quaternion={quaternion}>
        <mesh position={[0, height / 2, 0]} renderOrder={8} raycast={() => null}>
          <cylinderGeometry args={[0.0035, 0.0012, height, 16, 1, true]} />
          <shaderMaterial
            args={[{ uniforms, vertexShader: beamVertex, fragmentShader: beamFragment }]}
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      </group>
      <SurfacePulse key={analog.id} lat={analog.lat} lon={analog.lon} radius={EARTH_RADIUS} size={0.011} color={[1.6, 0.9, 0.25]} speed={0.55} />
    </group>
  )
}

const _w = new Vector3()

/** Hides an in-scene label when its anchor rotates behind a planet. */
function useOcclusion(group, label) {
  useFrame(({ camera }) => {
    if (!label.current || !group.current) return
    group.current.getWorldPosition(_w)
    label.current.style.opacity = isOccludedByPlanets(camera.position, _w) ? '0' : '1'
  })
}

/** Callout on the analog currently compared: name, inventory code, rank and match. */
function AnalogCallout({ analog, rank, score }) {
  const group = useRef()
  const label = useRef()
  const position = useMemo(() => latLonToVector3(analog.lat, analog.lon, EARTH_RADIUS * 1.003).toArray(), [analog])
  useOcclusion(group, label)
  return (
    <group ref={group} position={position}>
      <Html position={[0, 0, 0]} zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
        {/* label centred above the reticle: it stays inside the column between the two Earth panels */}
        <div ref={label} key={analog.id} className="analog-callout analog-callout--top" aria-hidden="true" style={{ transition: 'opacity 0.25s' }}>
          <Reticle className="glf-callout__reticle" tone="amber" locked />
          <span className="analog-callout__stem" />
          <div className="analog-label">
            <div className="analog-label__eyebrow">
              Andean analog · #{rank.toLocaleString('en-US')}
            </div>
            <div className="analog-label__name">{analog.name}</div>
            <div className="analog-label__meta">
              {analog.code} · <span className="text-amber">{pct(score)}</span>
            </div>
          </div>
        </div>
      </Html>
    </group>
  )
}

/**
 * In-scene tag: the best ice bodies for this Mars site (ranked) and the team's field benchmarks
 * (Morenas Coloradas, Dos Lenguas) with their rank, so the contrast is explicit.
 */
function GlacierTag({ glacier, rank, score, best }) {
  const group = useRef()
  const label = useRef()
  const position = useMemo(() => latLonToVector3(glacier.lat, glacier.lon, EARTH_RADIUS * 1.002).toArray(), [glacier])
  useOcclusion(group, label)
  return (
    <group ref={group} position={position}>
      <Html position={[0, 0, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }} center>
        <div ref={label} className={`ref-label ${best ? 'ref-label--best' : ''}`} aria-hidden="true">
          <span className="ref-label__diamond" />
          <span className="font-mono">#{rank.toLocaleString('en-US')}</span>
          {glacier.benchmark ? glacier.benchmark.name : glacier.name}
          <span className="font-mono text-white/80">{pct(score)}</span>
        </div>
      </Html>
    </group>
  )
}

/** Scene 2 overlays: beacon + callout on the compared glacier, tags on the benchmark glaciers. */
export default function AnalogSites() {
  const match = useMissionStore((s) => s.selectedAnalog)
  const phase = useMissionStore((s) => s.phase)
  const scoring = useMissionStore(activeScoring)
  const data = useMissionStore((s) => s.andes.data)
  const onEarth = phase === 'earth'
  // the 5 best ice bodies (one per climate cell) get a ranked tag on the globe
  const top = useMemo(() => (data && scoring ? bestIces(data, scoring, 5) : []), [data, scoring])
  if (!match) return null
  const analog = match.analog
  const tagged = new Set([match.analogIndex])
  return (
    <>
      <Beacon analog={analog} active={phase === 'earth' || phase === 'transit'} />
      {onEarth && scoring && <AnalogCallout analog={analog} rank={scoring.rank[match.analogIndex] + 1} score={scoring.score[match.analogIndex]} />}
      {onEarth &&
        scoring &&
        top
          .filter((e) => !tagged.has(e.index) && tagged.add(e.index))
          .map((e) => <GlacierTag key={`top-${e.index}`} glacier={e.glacier} rank={e.rank} score={e.score} best />)}
      {onEarth &&
        scoring &&
        data?.benchmarks
          .filter((i) => !tagged.has(i))
          .map((i) => <GlacierTag key={`bm-${i}`} glacier={data.glaciers[i]} rank={scoring.rank[i] + 1} score={scoring.score[i]} />)}
    </>
  )
}
