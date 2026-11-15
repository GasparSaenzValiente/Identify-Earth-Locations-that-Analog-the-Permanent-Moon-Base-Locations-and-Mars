/**
 * Andean side of the comparison: the coincidence-pipeline results for the Argentine glacier
 * inventory (one record per glacier) and for the uniform survey grid along the Andes, as packed by
 * `scripts/build-andes-data.mjs` into /public/data/andes_analogs.json.
 *
 *   params[]   six compared parameters: stage, weight, Mars reference value and the P5–P95 band
 *              (lo, hi) of the log-distance ramp the pipeline uses for its similarity
 *   cells[]    unique climate signatures: Earth values + signed ln(earth / mars_ref)
 *   glaciers   columnar: ING id, lat, lon, climate cell, pipeline scores, thermal-model status,
 *              nearest survey point
 *   survey     columnar: lat, lon, absolute score, thermal-model status
 */
import mock from '../data/mockAnalogMatches.json'
import { ANDES_SECTORS } from '../data/andesGazetteer'
import { EARTH_RADIUS_KM } from '../config/scene'
import { greatCircleKm } from '../lib/geo'

const DATA_URL = `${import.meta.env.BASE_URL}data/andes_analogs.json`
const GRID_DEG = 0.5
const BENCHMARK_MAX_KM = 3

/** Curated analogs from the team's reference pairs, attached to their inventory glacier. */
const CURATED = Object.entries(mock.earth_analogs).map(([marsId, a]) => ({ marsId, ...a }))

export const THERMAL_STATUS = {
  0: { label: 'Computed', detail: 'SoilGrids + thermal model (ERA5-Land humidity omitted)', ok: true },
  1: { label: 'Out of domain', detail: 'Outside the mineral-soil domain or organic carbon > 5 %', ok: false },
  2: { label: 'Partial', detail: 'Insufficient hourly coverage for the thermal model', ok: false },
}

function gridKey(lat, lon) {
  return `${Math.floor(lat / GRID_DEG)}:${Math.floor(lon / GRID_DEG)}`
}

function buildGrid(items) {
  const grid = new Map()
  for (const it of items) {
    const k = gridKey(it.lat, it.lon)
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(it.index)
  }
  return grid
}

/** Nearest item to (lat, lon) within `maxKm`, using the 0.5° grid. */
export function pickNearest(grid, items, lat, lon, maxKm, accept = () => true) {
  const dLat = maxKm / 111 + GRID_DEG
  const dLon = maxKm / (111 * Math.max(0.15, Math.cos((lat * Math.PI) / 180))) + GRID_DEG
  const here = { lat, lon }
  let best = null
  let bestKm = maxKm
  for (let a = Math.floor((lat - dLat) / GRID_DEG); a <= Math.floor((lat + dLat) / GRID_DEG); a++) {
    for (let b = Math.floor((lon - dLon) / GRID_DEG); b <= Math.floor((lon + dLon) / GRID_DEG); b++) {
      const cell = grid.get(`${a}:${b}`)
      if (!cell) continue
      for (const i of cell) {
        const it = items[i]
        if (!accept(it)) continue
        const d = greatCircleKm(here, it, EARTH_RADIUS_KM)
        if (d < bestKm) {
          bestKm = d
          best = it
        }
      }
    }
  }
  return best
}

function nearestSector(lat, lon) {
  let best = ANDES_SECTORS[0]
  let bestKm = Infinity
  for (const s of ANDES_SECTORS) {
    const d = greatCircleKm({ lat, lon }, s, EARTH_RADIUS_KM)
    if (d < bestKm) {
      bestKm = d
      best = s
    }
  }
  return best
}

function decode(raw) {
  const g = raw?.glaciers
  const sv = raw?.survey
  if (!Array.isArray(raw?.params) || !Array.isArray(raw?.cells) || !Array.isArray(g?.id) || !Array.isArray(sv?.id)) {
    throw new Error('Andean analog dataset has an unexpected format')
  }
  const survey = sv.id.map((id, i) => ({
    index: i,
    kind: 'survey',
    id: `survey-${id}`,
    number: id,
    lat: sv.lat[i],
    lon: sv.lon[i],
    absolute: sv.absolute[i],
    thermal: sv.thermal[i],
  }))
  const glaciers = g.id.map((id, i) => {
    const sector = nearestSector(g.lat[i], g.lon[i])
    return {
      index: i,
      kind: 'andes',
      id,
      code: id,
      name: sector.name,
      sector,
      lat: g.lat[i],
      lon: g.lon[i],
      cell: g.cell[i],
      relative: g.relative[i],
      absolute: g.absolute[i],
      thermal: g.thermal[i],
      era5: g.era5[i] === 1,
      surveyIndex: g.survey[i],
      surveyKm: g.surveyKm[i],
      benchmark: null,
    }
  })
  const glacierGrid = buildGrid(glaciers)
  const benchmarks = []
  for (const c of CURATED) {
    const hit = pickNearest(glacierGrid, glaciers, c.lat, c.lon, BENCHMARK_MAX_KM)
    if (!hit) continue
    hit.benchmark = { name: c.name, basin: c.basin, marsId: c.marsId, offsetKm: greatCircleKm(c, hit, EARTH_RADIUS_KM) }
    hit.name = c.name
    benchmarks.push(hit.index)
  }
  return {
    params: raw.params,
    cells: raw.cells,
    criterion: raw.criterion,
    reference: Object.fromEntries(raw.params.map((p) => [p.key, p.mars])),
    totalWeight: raw.params.reduce((a, p) => a + p.weight, 0),
    glaciers,
    survey,
    sectors: ANDES_SECTORS,
    benchmarks,
    glacierGrid,
    surveyGrid: buildGrid(survey),
    surveyInDomain: survey.filter((s) => s.thermal === 0).length,
  }
}

let pending = null
/** Fetch + decode once; concurrent callers share the request, failures can be retried. */
export function loadAndesData(url = DATA_URL) {
  pending ??= fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Could not load the Andean analog dataset (${res.status})`)
      return res.json()
    })
    .then(decode)
    .catch((err) => {
      pending = null
      throw err
    })
  return pending
}
