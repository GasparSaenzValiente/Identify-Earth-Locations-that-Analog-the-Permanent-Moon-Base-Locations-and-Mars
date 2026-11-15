#!/usr/bin/env node
/**
 * Builds public/data/andes_analogs.json from the two coincidence-pipeline exports:
 *
 *   data/source/resultados_coincidencia_glaciares.json   one record per inventoried Andean glacier
 *   data/source/resultados_coincidencia.json             one record per uniform survey point
 *
 * The browser never downloads the 23 MB raw exports. This script:
 *   1. recovers the pipeline's similarity curve for every parameter — a linear ramp on the log
 *      distance, sim = clamp01(1 − (|ln(earth/mars)| − lo) / (hi − lo)) — by least squares, and
 *      verifies it reproduces every `similitud` (and every `porcentaje_coincidencia`) exactly;
 *   2. de-duplicates the per-glacier climate values into "climate cells" (glaciers that share the
 *      same reanalysis cell share all six Earth values);
 *   3. links every glacier to its nearest survey point;
 *   4. writes a compact, columnar JSON.
 *
 * Usage:  node scripts/build-andes-data.mjs [glaciers.json] [survey.json] [out.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [glacierPath = path.join(root, 'data/source/resultados_coincidencia_glaciares.json'),
  surveyPath = path.join(root, 'data/source/resultados_coincidencia.json'),
  outPath = path.join(root, 'public/data/andes_analogs.json')] = process.argv.slice(2)

const PARAMS = ['z0', 't_superficie', 'p_superficie', 'rho_aire', 'viento_10m', 'solar']

const glaciers = JSON.parse(fs.readFileSync(glacierPath, 'utf8'))
const survey = JSON.parse(fs.readFileSync(surveyPath, 'utf8'))
if (!Array.isArray(glaciers) || !Array.isArray(survey)) throw new Error('expected two JSON arrays')

const fail = (msg) => {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

// ── 1. parameter metadata + Mars reference values ──────────────────────────────────────────────
const meta = Object.fromEntries(PARAMS.map((p) => [p, { mars: null, stage: null, weight: null, pts: new Map() }]))
for (const g of glaciers) {
  if ((g.detalles ?? []).length !== PARAMS.length) fail(`glacier ${g.id}: expected ${PARAMS.length} parameters`)
  for (const d of g.detalles) {
    const m = meta[d.parametro]
    if (!m) fail(`unknown parameter ${d.parametro}`)
    m.mars ??= d.valor_marte
    m.stage ??= d.etapa
    m.weight ??= d.peso_etapa
    if (m.mars !== d.valor_marte || m.stage !== d.etapa || m.weight !== d.peso_etapa) {
      fail(`${d.parametro}: Mars value / stage / weight is not constant across the dataset`)
    }
    m.pts.set(d.distancia_log, d.similitud)
  }
}

// ── 2. fit the similarity ramp per parameter ──────────────────────────────────────────────────
const curves = {}
for (const p of PARAMS) {
  const pts = [...meta[p].pts.entries()]
  const mid = pts.filter(([, s]) => s > 1e-9 && s < 1 - 1e-9)
  if (mid.length < 3) fail(`${p}: not enough interior points to fit the similarity curve`)
  const mx = mid.reduce((a, [x]) => a + x, 0) / mid.length
  const my = mid.reduce((a, [, y]) => a + y, 0) / mid.length
  let sxy = 0
  let sxx = 0
  for (const [x, y] of mid) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
  }
  const slope = sxy / sxx
  const width = -1 / slope
  const lo = (my - slope * mx - 1) * width
  const curve = { lo, hi: lo + width }
  let maxErr = 0
  for (const [d, s] of pts) maxErr = Math.max(maxErr, Math.abs(simFromDistance(d, curve) - s))
  if (maxErr > 1e-9) fail(`${p}: fitted ramp does not reproduce the pipeline (max error ${maxErr})`)
  curves[p] = curve
  console.log(`✓ ${p.padEnd(13)} lo ${lo.toFixed(6)}  hi ${curve.hi.toFixed(6)}  max error ${maxErr.toExponential(1)}`)
}

function simFromDistance(d, { lo, hi }) {
  return Math.min(1, Math.max(0, 1 - (d - lo) / (hi - lo)))
}

// ── 3. climate cells (unique six-value signatures) ────────────────────────────────────────────
const cellIndex = new Map()
const cells = []
const totalWeight = PARAMS.reduce((a, p) => a + meta[p].weight, 0)
let maxScoreErr = 0
const glacierCell = glaciers.map((g) => {
  const byKey = Object.fromEntries(g.detalles.map((d) => [d.parametro, d]))
  const key = PARAMS.map((p) => byKey[p].valor_tierra).join('|')
  let score = 0
  for (const p of PARAMS) score += meta[p].weight * byKey[p].similitud
  maxScoreErr = Math.max(maxScoreErr, Math.abs((100 * score) / totalWeight - g.porcentaje_coincidencia))
  if (!cellIndex.has(key)) {
    cellIndex.set(key, cells.length)
    cells.push({
      earth: PARAMS.map((p) => byKey[p].valor_tierra),
      // signed log distance ln(earth / mars): re-scoring against another Mars profile only needs
      // ln(mars_ref / mars_new) added to it (and stays exact when the Earth value is ~0)
      logRatio: PARAMS.map((p) => (byKey[p].valor_tierra >= meta[p].mars ? 1 : -1) * byKey[p].distancia_log),
    })
  }
  return cellIndex.get(key)
})
if (maxScoreErr > 1e-9) fail(`weighted score does not reproduce porcentaje_coincidencia (max error ${maxScoreErr})`)
console.log(`✓ score formula Σ wᵢ·simᵢ / Σ wᵢ reproduces every glacier (max error ${maxScoreErr.toExponential(1)})`)
console.log(`✓ ${glaciers.length} glaciers → ${cells.length} climate cells`)

// ── 4. thermal-model / data-coverage status ───────────────────────────────────────────────────
// 0 = soil thermal model computed (ERA5-Land humidity omitted), 1 = outside the mineral-soil domain
// or organic carbon > 5 %, 2 = insufficient hourly coverage
function thermalStatus(rec) {
  const t = (rec.errores_fuente ?? []).find((e) => e.fuente === 'Modelo termico')
  if (!t) return 0
  return /cobertura insuficiente/i.test(t.error) ? 2 : 1
}
const era5Omitted = (rec) => (rec.errores_fuente ?? []).some((e) => e.fuente === 'ERA5-Land/Open-Meteo')

// ── 5. nearest survey point for every glacier ─────────────────────────────────────────────────
const R = 6371
const rad = Math.PI / 180
function km(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * rad
  const dLon = (bLon - aLon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
const nearestSurvey = glaciers.map((g) => {
  let best = -1
  let bestKm = Infinity
  for (let j = 0; j < survey.length; j++) {
    if (Math.abs(survey[j].lat - g.lat) > 3) continue
    const d = km(g.lat, g.lon, survey[j].lat, survey[j].lon)
    if (d < bestKm) {
      bestKm = d
      best = j
    }
  }
  return [best, bestKm]
})

// ── 6. write ──────────────────────────────────────────────────────────────────────────────────
const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d
const out = {
  version: 1,
  // no build date: the output only changes when data/source changes (clean diffs)
  criterion: glaciers[0]?.criterio ?? 'relativo_comunes',
  params: PARAMS.map((p) => ({ key: p, stage: meta[p].stage, weight: meta[p].weight, mars: meta[p].mars, ...curves[p] })),
  cells,
  glaciers: {
    id: glaciers.map((g) => g.id),
    lat: glaciers.map((g) => r(g.lat, 5)),
    lon: glaciers.map((g) => r(g.lon, 5)),
    cell: glacierCell,
    relative: glaciers.map((g) => r(g.porcentaje_coincidencia, 4)),
    absolute: glaciers.map((g) => r(g.porcentaje_absoluto, 3)),
    thermal: glaciers.map(thermalStatus),
    era5: glaciers.map((g) => (era5Omitted(g) ? 0 : 1)),
    survey: nearestSurvey.map(([j]) => j),
    surveyKm: nearestSurvey.map(([, d]) => r(d, 1)),
  },
  survey: {
    id: survey.map((s) => s.id),
    lat: survey.map((s) => r(s.lat, 5)),
    lon: survey.map((s) => r(s.lon, 5)),
    absolute: survey.map((s) => r(s.porcentaje_absoluto, 3)),
    thermal: survey.map(thermalStatus),
  },
}
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(out))
const kb = (fs.statSync(outPath).size / 1024).toFixed(0)
console.log(`✓ ${survey.length} survey points (${survey.filter((s) => thermalStatus(s) === 0).length} inside the thermal-model domain)`)
console.log(`→ ${path.relative(root, outPath)} (${kb} KB)`)
