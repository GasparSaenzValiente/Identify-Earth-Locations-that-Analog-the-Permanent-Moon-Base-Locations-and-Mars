import { PLANETS } from '../config/scene'

const PLANET_LIST = Object.values(PLANETS)

/**
 * True if the straight segment camera → point enters the sphere before reaching the point.
 * Analytic (no raycasting), cheap enough to run per label per frame.
 */
export function isOccludedBySphere(cam, point, center, radius) {
  const dx = point.x - cam.x
  const dy = point.y - cam.y
  const dz = point.z - cam.z
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (len === 0) return false
  const ox = center.x - cam.x
  const oy = center.y - cam.y
  const oz = center.z - cam.z
  const b = (ox * dx + oy * dy + oz * dz) / len // projection of the centre on the sight line
  const c = ox * ox + oy * oy + oz * oz - radius * radius
  const disc = b * b - c
  if (disc < 0) return false
  const tEnter = b - Math.sqrt(disc)
  return tEnter > 0 && tEnter < len * 0.9995
}

/** Occluded by either planet (radii shrunk a hair so surface-hugging labels stay visible). */
export function isOccludedByPlanets(cam, point) {
  return PLANET_LIST.some((p) => isOccludedBySphere(cam, point, p.center, p.radius * 0.998))
}
