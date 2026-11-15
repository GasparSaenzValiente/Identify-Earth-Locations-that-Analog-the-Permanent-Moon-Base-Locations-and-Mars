import { Matrix4, Quaternion, Vector3 } from 'three'

export const clamp01 = (x) => Math.min(1, Math.max(0, x))
export const lerp = (a, b, t) => a + (b - a) * t

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2

export function easeOutBack(t) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

/** Any unit vector perpendicular to `v`. */
export function anyPerpendicular(v, out = new Vector3()) {
  const helper = Math.abs(v.y) < 0.9 ? _Y : _X
  return out.crossVectors(v, helper).normalize()
}

/**
 * Spherical interpolation between two unit vectors. When they are (nearly) opposite the
 * rotation plane is undefined, so we rotate about `fallbackAxis` (must be ⟂ to `a`).
 */
export function slerpUnitVectors(a, b, t, out = new Vector3(), fallbackAxis = null) {
  const dot = Math.min(1, Math.max(-1, a.dot(b)))
  const omega = Math.acos(dot)
  if (omega < 1e-5) return out.copy(a).lerp(b, t).normalize()
  if (Math.PI - omega < 2e-3) {
    const axis = fallbackAxis ?? anyPerpendicular(a, _tmpAxis)
    return out.copy(a).applyAxisAngle(axis, omega * t)
  }
  const s = Math.sin(omega)
  const wa = Math.sin((1 - t) * omega) / s
  const wb = Math.sin(t * omega) / s
  return out.copy(a).multiplyScalar(wa).addScaledVector(b, wb).normalize()
}

const _X = new Vector3(1, 0, 0)
const _Y = new Vector3(0, 1, 0)
const _tmpAxis = new Vector3()
const _m = new Matrix4()

/** Orientation of a camera at `eye` looking at `target` (world up = +Y). */
export function lookQuaternion(eye, target, out = new Quaternion(), up = _Y) {
  _m.lookAt(eye, target, up)
  return out.setFromRotationMatrix(_m)
}

/** If `p` is closer than `minDistance` to `center`, push it out radially (in place). */
export function keepOutside(p, center, minDistance) {
  const dx = p.x - center.x
  const dy = p.y - center.y
  const dz = p.z - center.z
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (d >= minDistance || d === 0) return p
  const k = minDistance / d
  return p.set(center.x + dx * k, center.y + dy * k, center.z + dz * k)
}
