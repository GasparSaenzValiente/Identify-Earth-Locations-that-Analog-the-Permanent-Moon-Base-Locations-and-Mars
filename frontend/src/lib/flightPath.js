import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three'
import { CAMERA, FLIGHT } from '../config/scene'
import { anyPerpendicular, easeInOutSine, keepOutside, slerpUnitVectors, smoothstep } from './math'

/**
 * Camera "shots". A shot is a pure function of a progress value t ∈ [0, 1] that writes a full
 * camera pose into `out` ({ position, quaternion, target, focusCenter, fov }). GSAP only tweens
 * t; the CameraDirector evaluates the shot every frame. This keeps all camera math in one
 * place and makes every move resumable / reversible.
 *
 * Orientation uses a precomputed *parallel-transported* frame: the camera's up vector is carried
 * along the path instead of being forced to world +Y, so the view never spins when the look
 * direction passes close to a planet's polar axis (the classic lookAt singularity). Over the last
 * stretch the frame is blended back to a world-up lookAt so the handoff to OrbitControls (which
 * always uses world-up) is seamless.
 */

export function createPose() {
  return {
    position: new Vector3(),
    quaternion: new Quaternion(),
    target: new Vector3(),
    focusCenter: new Vector3(),
    fov: CAMERA.fov,
  }
}

const UP = new Vector3(0, 1, 0)
const _dir = new Vector3()
const _look = new Vector3()
const _toFrom = new Vector3()
const _toTo = new Vector3()
const _bx = new Vector3()
const _by = new Vector3()
const _bz = new Vector3()
const _bm = new Matrix4()

/** Camera orientation (looks down −Z) from a forward direction and an up hint. */
function basisQuaternion(forward, up, out) {
  _bz.copy(forward).negate()
  _bx.crossVectors(up, _bz)
  if (_bx.lengthSq() < 1e-10) anyPerpendicular(_bz, _bx)
  _bx.normalize()
  _by.crossVectors(_bz, _bx)
  _bm.makeBasis(_bx, _by, _bz)
  return out.setFromRotationMatrix(_bm)
}

/**
 * Sample `forwardAt(t, outForward)` n+1 times and build camera quaternions:
 *  1. the up vector is parallel-transported from `startUp` (the camera's actual up when the shot
 *     starts — so interrupting a shot, or starting from a pole, never snaps the roll), so it never
 *     spins when the look direction sweeps past a pole;
 *  2. the single roll offset between the transported up and world-up at t = 1 is measured once and
 *     distributed smoothly over [settleFrom, settleTo], rotating about each sample's own forward
 *     axis (rotation-minimising frames commute with that roll) — so the shot ends exactly in
 *     OrbitControls' world-up lookAt frame with no singularity anywhere. Flights settle the roll
 *     during the cruise, where only stars are on screen; orbit moves spread it over the whole move.
 */
function buildOrientationTrack(n, forwardAt, { settleFrom = 0.8, settleTo = 1, startUp = UP } = {}) {
  const forwards = []
  const ups = []
  const up = startUp.clone()
  for (let i = 0; i <= n; i++) {
    const f = forwardAt(i / n, new Vector3())
    up.addScaledVector(f, -up.dot(f))
    if (up.lengthSq() < 1e-10) anyPerpendicular(f, up)
    up.normalize()
    forwards.push(f)
    ups.push(up.clone())
  }

  const fEnd = forwards[n]
  const uEnd = ups[n]
  const target = UP.clone().addScaledVector(fEnd, -UP.dot(fEnd))
  let roll = 0
  if (target.lengthSq() > 1e-6) {
    target.normalize()
    roll = Math.atan2(_bx.crossVectors(uEnd, target).dot(fEnd), uEnd.dot(target))
  }

  return forwards.map((f, i) => {
    const w = smoothstep(settleFrom, settleTo, i / n)
    const u = w > 0 && roll !== 0 ? ups[i].applyAxisAngle(f, roll * w) : ups[i]
    return basisQuaternion(f, u, new Quaternion())
  })
}

function sampleTrack(track, t, out) {
  const x = MathUtils.clamp(t, 0, 1) * (track.length - 1)
  const i = Math.min(track.length - 2, Math.floor(x))
  return out.copy(track[i]).slerp(track[i + 1], x - i)
}

/**
 * Move around a single planet: the direction from the planet centre is slerped (so the camera
 * never cuts through the globe) while the distance is interpolated, with an outward "hop" for
 * long moves. Used for the intro, focusing a glacier and jumping between regions.
 */
export function createOrbitShot({ center, startPosition, startTarget, endDirection, endDistance, hop, startUp }) {
  const c = center.clone()
  const d0 = startPosition.clone().sub(c)
  const r0 = d0.length()
  d0.normalize()
  const d1 = endDirection.clone().normalize()
  const angle = d0.angleTo(d1)
  const fallback = anyPerpendicular(d0)
  const hopHeight = hop ?? (angle / Math.PI) * 0.55 * Math.max(r0, endDistance)
  const target0 = startTarget.clone()

  const positionAt = (t, out) => {
    slerpUnitVectors(d0, d1, easeInOutSine(t), _dir, fallback)
    const r = MathUtils.lerp(r0, endDistance, t) + Math.sin(Math.PI * t) * hopHeight
    return out.copy(c).addScaledVector(_dir, r)
  }
  const targetAt = (t, out) => out.copy(target0).lerp(c, smoothstep(0, 0.7, t))

  const p = new Vector3()
  const tg = new Vector3()
  const track = buildOrientationTrack(
    360,
    (t, f) => {
      positionAt(t, p)
      targetAt(t, tg)
      return f.copy(tg).sub(p).normalize()
    },
    { settleFrom: 0, settleTo: 1, startUp },
  )

  return {
    evaluate(t, out) {
      positionAt(t, out.position)
      targetAt(t, out.target)
      sampleTrack(track, t, out.quaternion)
      out.focusCenter.copy(c)
      out.fov = CAMERA.fov
    },
  }
}

/**
 * Interplanetary flight from one body to another.
 *
 * Path (all in world space):
 *   1. departure — spiral outwards around `from` (direction slerp + growing radius), the camera
 *      keeps looking at `from`: this is the "zoom out";
 *   2. cruise — a gently bowed segment between two points that sit on the facing sides of both
 *      planets, offset sideways, so the straight part can never intersect either globe;
 *   3. arrival — spiral inwards around `to` until the camera hangs above `endDirection`
 *      (the analog's coordinates), finishing with a short radial zoom.
 * The samples are joined with a centripetal Catmull–Rom spline and traversed by arc length,
 * so a single GSAP ease gives: slow pull-back → fast cruise → slow descent.
 *
 * Look direction: towards `from` during the pull-back, then slerped towards `to` while
 * accelerating; the full frame comes from the parallel-transported orientation track.
 */
export function createFlightShot({ from, to, startPosition, startTarget, endDirection, endDistance, startUp }) {
  const fromC = from.center.clone()
  const toC = to.center.clone()
  const axis = toC.clone().sub(fromC)
  const distance = axis.length()
  axis.normalize()

  const d0 = startPosition.clone().sub(fromC)
  const r0 = d0.length()
  d0.normalize()

  // Sideways vector ⟂ to the travel axis, on the side where the camera already is.
  const side = new Vector3().crossVectors(axis, UP)
  if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
  side.normalize()
  if (d0.dot(side) < 0) side.negate()
  const lift = new Vector3().crossVectors(side, axis).normalize()

  const points = []

  // 1 — departure spiral around `from`
  const depDir = axis.clone().multiplyScalar(0.6).addScaledVector(side, 0.62).addScaledVector(lift, 0.2).normalize()
  const depR = from.radius * FLIGHT.departureRadii
  const depFallback = anyPerpendicular(d0)
  const depSteps = Math.max(3, Math.ceil(d0.angleTo(depDir) / (Math.PI / 9)))
  for (let i = 0; i <= depSteps; i++) {
    const t = i / depSteps
    const dir = slerpUnitVectors(d0, depDir, easeInOutSine(t), new Vector3(), depFallback)
    points.push(fromC.clone().addScaledVector(dir, MathUtils.lerp(r0, depR, t)))
  }
  const departureEnd = points[points.length - 1].clone()

  // Arrival anchor around `to` (Mars-facing side, offset like the departure)
  const end = endDirection.clone().normalize()
  const arrDir = axis.clone().multiplyScalar(-0.6).addScaledVector(side, 0.62).addScaledVector(lift, 0.2).normalize()
  const arrR = to.radius * FLIGHT.arrivalRadii
  const arrivalStart = toC.clone().addScaledVector(arrDir, arrR)

  // 2 — cruise: bowed segment between the two anchors
  const bow = lift.clone().multiplyScalar(distance * 0.07)
  for (const s of [0.2, 0.4, 0.6, 0.8]) {
    points.push(departureEnd.clone().lerp(arrivalStart, s).addScaledVector(bow, Math.sin(Math.PI * s)))
  }

  // 3 — arrival spiral, then a short radial zoom onto the coordinates
  const approachR = endDistance * 1.75
  const arrSteps = Math.max(3, Math.ceil(arrDir.angleTo(end) / (Math.PI / 9)))
  for (let i = 0; i <= arrSteps; i++) {
    const t = i / arrSteps
    const dir = slerpUnitVectors(arrDir, end, easeInOutSine(t), new Vector3(), lift)
    points.push(toC.clone().addScaledVector(dir, MathUtils.lerp(arrR, approachR, easeInOutSine(t))))
  }
  points.push(toC.clone().addScaledVector(end, endDistance * 1.25))
  points.push(toC.clone().addScaledVector(end, endDistance))

  const curve = new CatmullRomCurve3(points, false, 'centripetal')
  curve.arcLengthDivisions = 2400

  const target0 = startTarget.clone()
  // If the user had zoomed in closer than the safety shell, start from there and ease out to it
  // (instead of popping outwards on the first frame).
  const fromMinStart = Math.min(from.radius * 1.12, r0 * 0.999)
  const fromMin = from.radius * 1.12
  const toMin = to.radius * 1.025

  const positionAt = (t, out) => {
    curve.getPointAt(MathUtils.clamp(t, 0, 1), out)
    keepOutside(out, fromC, MathUtils.lerp(fromMinStart, fromMin, smoothstep(0, 0.06, t)))
    return keepOutside(out, toC, toMin)
  }
  // The turn from looking back at `from` to facing `to`: spread wide enough that, with the flight's
  // power3 ease, it never whips the view around.
  const turn = (t) => smoothstep(0.05, 0.55, t)
  const lookFromAt = (t, out) => out.copy(target0).lerp(fromC, smoothstep(0, 0.08, t))

  const p = new Vector3()
  const track = buildOrientationTrack(
    1200,
    (t, f) => {
      positionAt(t, p)
      lookFromAt(t, _look)
      _toFrom.copy(_look).sub(p).normalize()
      _toTo.copy(toC).sub(p).normalize()
      return slerpUnitVectors(_toFrom, _toTo, turn(t), f, lift)
    },
    // Progress window, not time: with the power3 ease the cruise flies through t≈0.4–0.7 in well
    // under a second, so the roll is spread over most of the cruise instead.
    { settleFrom: 0.15, settleTo: 0.88, startUp },
  )

  return {
    curve,
    distance,
    evaluate(t, out) {
      positionAt(t, out.position)
      lookFromAt(t, _look)
      out.target.copy(_look).lerp(toC, turn(t))
      sampleTrack(track, t, out.quaternion)
      out.focusCenter.copy(fromC).lerp(toC, smoothstep(0.3, 0.72, t))
      out.fov = CAMERA.fov
    },
  }
}
