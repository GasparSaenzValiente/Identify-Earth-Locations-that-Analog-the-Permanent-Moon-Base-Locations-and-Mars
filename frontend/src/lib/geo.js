import { MathUtils, Vector3 } from 'three'

const { DEG2RAD, RAD2DEG } = MathUtils

/** Wrap a longitude (degrees) into [-180, 180). */
export function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

/**
 * Latitude/longitude (degrees, east-positive) → position on a sphere centred at the origin.
 *
 * Matches the UV layout of THREE.SphereGeometry with an equirectangular texture whose left
 * edge is 180°W (u = 0) and centre is the prime meridian (u = 0.5) — the layout used by
 * NASA Mars Trek, NASA GIBS and almost every global basemap.
 */
export function latLonToVector3(lat, lon, radius = 1, target = new Vector3()) {
  const phi = (lon + 180) * DEG2RAD
  const theta = (90 - lat) * DEG2RAD
  const s = Math.sin(theta)
  return target.set(-radius * s * Math.cos(phi), radius * Math.cos(theta), radius * s * Math.sin(phi))
}

/** Inverse of latLonToVector3 (vector relative to the planet centre). */
export function vector3ToLatLon(v) {
  const r = v.length() || 1
  const lat = 90 - Math.acos(MathUtils.clamp(v.y / r, -1, 1)) * RAD2DEG
  const lon = wrapLon(Math.atan2(v.z, -v.x) * RAD2DEG - 180)
  return { lat, lon }
}

/** The sphere's azimuthal angle for a longitude, in [0, 2π). Same convention as the scan shader. */
export function lonToPhi(lon) {
  return (wrapLon(lon) + 180) * DEG2RAD
}

/** Central angle (radians) between two lat/lon points — haversine. */
export function angularDistanceRad(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG2RAD
  const p2 = lat2 * DEG2RAD
  const dLat = p2 - p1
  const dLon = (lon2 - lon1) * DEG2RAD
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function greatCircleKm(a, b, radiusKm) {
  return angularDistanceRad(a.lat, a.lon, b.lat, b.lon) * radiusKm
}

export function formatLat(lat, digits = 2) {
  return `${Math.abs(lat).toFixed(digits)}°${lat >= 0 ? 'N' : 'S'}`
}

export function formatLon(lon, digits = 2) {
  const l = wrapLon(lon)
  return `${Math.abs(l).toFixed(digits)}°${l >= 0 ? 'E' : 'W'}`
}

export function formatLatLon(lat, lon, digits = 2) {
  return `${formatLat(lat, digits)} ${formatLon(lon, digits)}`
}
