/**
 * Loads the Souness et al. (2012) inventory of Martian glacier-like forms (GLFs) — the GeoJSON in
 * /public/data — and normalises each feature into a flat record the 3D layer can use directly.
 *
 * GeoJSON properties (as exported from the inventory, clon0 = longitudes centred on 0°):
 *   Latitude / Longitude          GLF centre (deg, east-positive, -180..180)
 *   glf_head_e / glf_head_l       head (upslope end) east-lon (0..360) / lat
 *   glf_termin / glf_term_1       terminus east-lon (0..360) / lat
 *   glf_length, glf_width_        km
 *   glf_area_s                    km²
 *   glf_orient                    downslope orientation, degrees from north
 *   buffer_min/max/mea/std        elevation statistics in a buffer around the GLF (m, MOLA datum)
 *   elongation                    length / width
 *   parent_ima                    parent CTX image id
 */
import { MARS_RADIUS_KM } from '../config/scene'
import { MARS_GAZETTEER } from '../data/marsGazetteer'
import { greatCircleKm, wrapLon } from '../lib/geo'

const DATA_URL = `${import.meta.env.BASE_URL}data/mars_glf_souness2012.geojson`

const LOCAL_FEATURES = MARS_GAZETTEER.filter((f) => !f.regional)
const REGIONAL_FEATURES = MARS_GAZETTEER.filter((f) => f.regional).sort((a, b) => a.diameterKm - b.diameterKm)

function inBBox(lat, lon, b) {
  if (lat > b.n || lat < b.s) return false
  return b.w <= b.e ? lon >= b.w && lon <= b.e : lon >= b.w || lon <= b.e
}

/**
 * Name a location after the most relevant IAU feature:
 *   1. the local feature (mensae, montes, valles, craters…) minimising distance relative to its size,
 *      accepted if within max(300 km, radius + 150 km);
 *   2. otherwise the smallest regional terra/planitia whose gazetteer extent contains the point AND
 *      whose centre is within 1.1 × its radius (bounding boxes alone are far too generous for
 *      irregular terrae);
 *   3. otherwise "near <closest local feature>" (by plain distance).
 */
export function nameForLocation(lat, lon) {
  const here = { lat, lon }
  let best = null
  let nearest = null
  for (const f of LOCAL_FEATURES) {
    const d = greatCircleKm(here, f, MARS_RADIUS_KM)
    const radius = f.diameterKm / 2
    const score = d / (radius + 150)
    if (!best || score < best.score) best = { feature: f, d, radius, score }
    if (!nearest || d < nearest.d) nearest = { feature: f, d }
  }
  if (best && best.d <= Math.max(300, best.radius + 150)) {
    return { region: best.feature.name, regionType: best.feature.type, inside: true, distanceKm: best.d }
  }
  for (const f of REGIONAL_FEATURES) {
    const d = greatCircleKm(here, f, MARS_RADIUS_KM)
    const inside = (f.bbox ? inBBox(lat, lon, f.bbox) : true) && d <= (f.diameterKm / 2) * 1.1
    if (inside) return { region: f.name, regionType: f.type, inside: true, distanceKm: d }
  }
  if (!nearest) return { region: 'Unnamed region', inside: false }
  return { region: nearest.feature.name, regionType: nearest.feature.type, inside: false, distanceKm: nearest.d }
}

function toRecord(feature, index) {
  const p = feature.properties ?? {}
  const [gLon, gLat] = feature.geometry?.coordinates ?? []
  const lat = Number.isFinite(p.Latitude) ? p.Latitude : gLat
  const lon = wrapLon(Number.isFinite(p.Longitude) ? p.Longitude : gLon)
  const naming = nameForLocation(lat, lon)
  const number = String(index + 1).padStart(4, '0')
  return {
    id: `glf-${number}`,
    index,
    kind: 'glf',
    number,
    name: naming.inside ? naming.region : `near ${naming.region}`,
    region: naming.region,
    lat,
    lon,
    lengthKm: p.glf_length,
    widthKm: p.glf_width_,
    areaKm2: p.glf_area_s,
    orientationDeg: p.glf_orient,
    elongation: p.elongation,
    elevation: { min: p.buffer_min, max: p.buffer_max, mean: p.buffer_mea, std: p.buffer_std },
    head: { lat: p.glf_head_l, lon: wrapLon(p.glf_head_e) },
    terminus: { lat: p.glf_term_1, lon: wrapLon(p.glf_termin) },
    ctxImage: p.parent_ima,
  }
}

export async function loadGlacierLikeForms(url = DATA_URL) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load GLF inventory (${res.status})`)
  const geo = await res.json()
  if (geo?.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    throw new Error('GLF inventory is not a GeoJSON FeatureCollection')
  }
  // Filter BEFORE mapping: `index` must equal the record's position in the returned array (it is
  // used as the InstancedMesh instance id for hover/selection highlighting).
  return geo.features
    .filter((f) => {
      if (f?.geometry?.type !== 'Point') return false
      const p = f.properties ?? {}
      const [x, y] = f.geometry.coordinates ?? []
      return Number.isFinite(p.Latitude ?? y) && Number.isFinite(p.Longitude ?? x)
    })
    .map(toRecord)
}

/** Per-region counts and centroids, for the region list in the HUD. */
export function summarizeRegions(glaciers) {
  const map = new Map()
  for (const g of glaciers) {
    const r = map.get(g.region) ?? { name: g.region, count: 0, x: 0, y: 0, z: 0, areaKm2: 0 }
    const la = (g.lat * Math.PI) / 180
    const lo = (g.lon * Math.PI) / 180
    r.count += 1
    r.x += Math.cos(la) * Math.cos(lo)
    r.y += Math.cos(la) * Math.sin(lo)
    r.z += Math.sin(la)
    r.areaKm2 += g.areaKm2 ?? 0
    map.set(g.region, r)
  }
  return [...map.values()]
    .map((r) => {
      const n = Math.hypot(r.x, r.y, r.z) || 1
      return {
        name: r.name,
        count: r.count,
        areaKm2: r.areaKm2,
        lat: (Math.asin(r.z / n) * 180) / Math.PI,
        lon: (Math.atan2(r.y, r.x) * 180) / Math.PI,
      }
    })
    .sort((a, b) => b.count - a.count)
}
