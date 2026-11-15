import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import gsap from 'gsap'
import { MathUtils, Vector3 } from 'three'
import { CAMERA, CONTROLS, EARTH_CENTER, EARTH_RADIUS, FLIGHT, MARS_CENTER, PLANETS } from '../config/scene'
import { createFlightShot, createOrbitShot, createPose } from '../lib/flightPath'
import { latLonToVector3 } from '../lib/geo'
import { clamp01 } from '../lib/math'
import { useMissionStore } from '../store/useMissionStore'
import { flightState } from './sharedState'

const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Apply any pending OrbitControls inertia instantly so it cannot "kick" after a scripted move. */
function flushControls(controls) {
  const damping = controls.enableDamping
  controls.enableDamping = false
  controls.update()
  controls.enableDamping = damping
}

const _up = new Vector3()
const _off = new Vector3()

/**
 * Owns the camera. Every scripted move is a "shot" (see lib/flightPath.js) whose progress is
 * tweened by GSAP and evaluated here each frame — after OrbitControls (priority −1) and before
 * everything that reads the camera (labels, sun light, warp streaks at priority 0).
 *
 * Choreography (driven by store transitions):
 *   mount            → intro glide towards Mars
 *   phase=matching   → frame the clicked glacier (in parallel the mock service resolves)
 *   analog + framed  → Mars → Earth flight, ending above the analog's coordinates
 *   phase=returning  → Earth → Mars flight back to the glacier
 *   focusRequest     → Mars-local hop to a region
 */
export default function CameraDirector() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const shot = useRef(null)
  const framed = useRef(false)
  const pose = useMemo(() => createPose(), [])
  const prev = useMemo(() => new Vector3(), [])

  useEffect(() => {
    if (!controls) return undefined

    const currentUp = () => _up.set(0, 1, 0).applyQuaternion(camera.quaternion).clone()
    const flightDuration = (d) => (REDUCED_MOTION ? Math.min(d, 2.4) : d)
    // Orbit moves scale with how far around the planet they go: short hops stay snappy, a swing to
    // the far side gets time to breathe instead of whipping the view around.
    const orbitDuration = (base, center, endDirection) => {
      const angle = camera.position.clone().sub(center).normalize().angleTo(endDirection)
      const d = base * MathUtils.clamp(0.6 + (angle / Math.PI) * 1.9, 0.6, 2.5)
      return REDUCED_MOTION ? Math.min(d, 1.2) : d
    }

    const release = (planetKey) => {
      const lim = CONTROLS[planetKey]
      controls.minDistance = lim.min
      controls.maxDistance = lim.max
      controls.target.copy(PLANETS[planetKey].center)
      controls.enabled = true
      controls.update()
    }

    const run = (s, { duration, ease = 'power2.inOut', flight = false, direction = 'toEarth', onComplete }) => {
      shot.current?.tween.kill()
      flushControls(controls)
      controls.enabled = false
      controls.autoRotate = false
      s.evaluate(0, pose)
      prev.copy(pose.position)
      const progress = { t: 0 }
      flightState.active = flight
      flightState.direction = direction
      flightState.progress = 0
      const tween = gsap.to(progress, {
        t: 1,
        duration,
        ease,
        onComplete: () => {
          s.evaluate(1, pose)
          camera.position.copy(pose.position)
          camera.quaternion.copy(pose.quaternion)
          controls.target.copy(pose.target)
          shot.current = null
          flightState.active = false
          flightState.progress = 1
          onComplete?.()
        },
      })
      // Warp is driven by speed relative to this flight's average, so it peaks mid-cruise whatever
      // the route length.
      const avgSpeed = s.curve ? s.curve.getLength() / duration : 0
      shot.current = { ...s, progress, tween, flight, avgSpeed }
    }

    // ── intro ───────────────────────────────────────────────────────────────────────────────
    camera.position.set(...CAMERA.introFrom)
    camera.lookAt(MARS_CENTER)
    controls.target.copy(MARS_CENTER)
    // Portrait screens: the FOV is vertical, so back off until Mars fits horizontally.
    const introEnd = new Vector3(...CAMERA.introTo).multiplyScalar(MathUtils.clamp(0.95 / camera.aspect, 1, 2.2))
    run(
      createOrbitShot({
        center: MARS_CENTER,
        startPosition: camera.position.clone(),
        startTarget: MARS_CENTER,
        endDirection: introEnd.clone().normalize(),
        endDistance: introEnd.length(),
        hop: 0,
        startUp: currentUp(),
      }),
      {
        duration: REDUCED_MOTION ? 1.2 : 3.8,
        ease: 'power3.out',
        onComplete: () => {
          release('mars')
          controls.autoRotate = useMissionStore.getState().phase === 'intro' && !REDUCED_MOTION
        },
      },
    )

    // ── Action 3: frame the glacier, then fly once the analog is known ──────────────────────
    const frameSite = (site) => {
      framed.current = false
      const endDirection = latLonToVector3(site.lat, site.lon, 1)
      run(
        createOrbitShot({
          center: MARS_CENTER,
          startPosition: camera.position.clone(),
          startTarget: controls.target.clone(),
          endDirection,
          endDistance: FLIGHT.focusDistance,
          startUp: currentUp(),
        }),
        {
          duration: orbitDuration(FLIGHT.focusDuration, MARS_CENTER, endDirection),
          onComplete: () => {
            framed.current = true
            tryDepart()
          },
        },
      )
    }

    // Framed + analog known → hand the camera back and wait for the user to launch.
    const tryDepart = () => {
      const st = useMissionStore.getState()
      if (!framed.current || !st.selectedAnalog || st.phase !== 'matching') return
      framed.current = false
      release('mars')
      st.awaitConfirm()
    }

    const flyToEarth = () => {
      const st = useMissionStore.getState()
      if (!st.selectedAnalog) return
      const { analog } = st.selectedAnalog
      run(
        createFlightShot({
          from: PLANETS.mars,
          to: PLANETS.earth,
          startPosition: camera.position.clone(),
          startTarget: controls.target.clone(),
          endDirection: latLonToVector3(analog.lat, analog.lon, 1),
          endDistance: EARTH_RADIUS * FLIGHT.earthFinalRadii,
          startUp: currentUp(),
        }),
        {
          duration: flightDuration(FLIGHT.duration),
          ease: FLIGHT.ease,
          flight: !REDUCED_MOTION,
          direction: 'toEarth',
          onComplete: () => {
            release('earth')
            useMissionStore.getState().arriveEarth()
          },
        },
      )
    }

    const flyBackToMars = (site) => {
      const introDir = new Vector3(...CAMERA.introTo).normalize()
      run(
        createFlightShot({
          from: PLANETS.earth,
          to: PLANETS.mars,
          startPosition: camera.position.clone(),
          startTarget: controls.target.clone(),
          endDirection: site ? latLonToVector3(site.lat, site.lon, 1) : introDir,
          endDistance: FLIGHT.marsReturnDistance,
          startUp: currentUp(),
        }),
        {
          duration: flightDuration(FLIGHT.returnDuration),
          ease: FLIGHT.ease,
          flight: !REDUCED_MOTION,
          direction: 'toMars',
          onComplete: () => {
            release('mars')
            useMissionStore.getState().arriveMars()
          },
        },
      )
    }

    const focusRegion = ({ lat, lon, distance }) => {
      const endDirection = latLonToVector3(lat, lon, 1)
      run(
        createOrbitShot({
          center: MARS_CENTER,
          startPosition: camera.position.clone(),
          startTarget: controls.target.clone(),
          endDirection,
          endDistance: distance ?? FLIGHT.regionDistance,
          startUp: currentUp(),
        }),
        { duration: orbitDuration(FLIGHT.regionDuration, MARS_CENTER, endDirection), onComplete: () => release('mars') },
      )
    }

    // On Earth: glide to another inventory glacier, keeping the user's zoom within a readable band.
    const focusEarth = ({ lat, lon }) => {
      const endDirection = latLonToVector3(lat, lon, 1)
      const distance = MathUtils.clamp(camera.position.distanceTo(EARTH_CENTER), EARTH_RADIUS * 1.1, EARTH_RADIUS * 1.9)
      run(
        createOrbitShot({
          center: EARTH_CENTER,
          startPosition: camera.position.clone(),
          startTarget: controls.target.clone(),
          endDirection,
          endDistance: distance,
          hop: 0.04,
          startUp: currentUp(),
        }),
        { duration: orbitDuration(FLIGHT.earthHopDuration, EARTH_CENTER, endDirection), onComplete: () => release('earth') },
      )
    }

    const unsubscribe = useMissionStore.subscribe((state, before) => {
      if (state.phase === 'matching' && before.phase !== 'matching' && state.selectedMarsSite) {
        frameSite(state.selectedMarsSite)
      }
      if (state.phase === 'matching' && state.selectedAnalog && !before.selectedAnalog) tryDepart()
      if (state.phase === 'transit' && before.phase === 'confirm') flyToEarth()
      if (state.phase === 'mars' && before.phase === 'matching') {
        // aborted, failed or timed out mid-framing → stop the shot and hand the camera back
        shot.current?.tween.kill()
        shot.current = null
        framed.current = false
        release('mars')
      }
      if (state.phase === 'mars' && before.phase === 'confirm') {
        // aborted from the flight plan: controls are already free — keep the user's view as is
        framed.current = false
      }
      if (state.phase === 'returning' && before.phase !== 'returning') flyBackToMars(state.selectedMarsSite)
      if (
        state.phase === 'earth' &&
        before.phase === 'earth' &&
        state.selectedAnalog &&
        state.selectedAnalog.analogIndex !== before.selectedAnalog?.analogIndex
      ) {
        focusEarth(state.selectedAnalog.analog)
      }
      if (state.focusRequest && state.focusRequest !== before.focusRequest && state.phase === 'mars') {
        focusRegion(state.focusRequest)
      }
      if (state.phase !== 'intro' && before.phase === 'intro') controls.autoRotate = false
    })

    return () => {
      unsubscribe()
      shot.current?.tween.kill()
      shot.current = null
    }
  }, [camera, controls, pose, prev])

  // Priority −0.5: after OrbitControls' update (−1), before the camera's consumers (0).
  useFrame((_, dt) => {
    const s = shot.current
    if (s) {
      s.evaluate(s.progress.t, pose)
      const speed = dt > 0 ? pose.position.distanceTo(prev) / dt : 0
      prev.copy(pose.position)
      const targetWarp = s.flight && s.avgSpeed > 0 ? clamp01((speed / s.avgSpeed - 0.9) / 1.3) : 0
      flightState.warp = MathUtils.damp(flightState.warp, targetWarp, 3.2, dt)
      flightState.progress = s.progress.t
      flightState.focusCenter.copy(pose.focusCenter)

      camera.position.copy(pose.position)
      camera.quaternion.copy(pose.quaternion)
      if (controls) controls.target.copy(pose.target)
      const fov = pose.fov + 20 * flightState.warp
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
      return
    }

    flightState.warp = MathUtils.damp(flightState.warp, 0, 4, dt)
    const key = useMissionStore.getState().activePlanet
    const planet = PLANETS[key]
    flightState.focusCenter.copy(planet.center)
    if (Math.abs(camera.fov - CAMERA.fov) > 0.01) {
      camera.fov = MathUtils.damp(camera.fov, CAMERA.fov, 4, dt)
      camera.updateProjectionMatrix()
    }

    // Free navigation guards: panning moves the orbit target, and min/maxDistance are measured from
    // the target — keep the target near the planet and the camera outside it.
    if (controls?.enabled) {
      _off.copy(controls.target).sub(planet.center)
      const maxOffset = planet.radius * 0.6
      if (_off.length() > maxOffset) controls.target.copy(planet.center).addScaledVector(_off.normalize(), maxOffset)
      _off.copy(camera.position).sub(planet.center)
      const minDist = CONTROLS[key].min
      if (_off.length() < minDist) camera.position.copy(planet.center).addScaledVector(_off.normalize(), minDist)
    }
  }, -0.5)

  return null
}
