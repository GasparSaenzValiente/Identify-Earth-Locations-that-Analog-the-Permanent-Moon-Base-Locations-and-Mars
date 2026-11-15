/**
 * Mars ↔ Andes ice-environment scoring — the coincidence pipeline's method, reproduced exactly.
 *
 * For each parameter k the pipeline measures the log distance dₖ = |ln(earthₖ / marsₖ)| and maps it
 * to a similarity with a linear ramp between the 5th and 95th percentile of that distance across the
 * whole Andean inventory (lo, hi):
 *
 *     simₖ = clamp01(1 − (dₖ − loₖ) / (hiₖ − loₖ))
 *
 * and the match is the stage-weighted mean  100 · Σ wₖ·simₖ / Σ wₖ  (E1 = 2, E3 = 4, E4 = 5).
 * Against the pipeline's own Mars profile this reproduces every `porcentaje_coincidencia` of the
 * dataset. Against a site-specific Mars profile the same tolerance band is kept, so a site whose
 * conditions sit closer to the Andes scores higher.
 */

export const PARAM_INFO = {
  z0: { label: 'Surface roughness', symbol: 'z₀', unit: 'm', digits: 4 },
  t_superficie: { label: 'Surface temperature', symbol: 'T', unit: 'K', digits: 1 },
  p_superficie: { label: 'Surface pressure', symbol: 'P', unit: 'Pa', digits: 0 },
  rho_aire: { label: 'Air density', symbol: 'ρ', unit: 'kg/m³', digits: 3 },
  viento_10m: { label: 'Wind at 10 m', symbol: 'U₁₀', unit: 'm/s', digits: 1 },
  solar: { label: 'Solar irradiance', symbol: 'S', unit: 'W/m²', digits: 0 },
}

export const STAGE_INFO = {
  E1: { label: 'Surface', detail: 'Roughness · temperature' },
  E3: { label: 'Atmosphere', detail: 'Pressure · density' },
  E4: { label: 'Forcing', detail: 'Wind · irradiance' },
}

export const HISTOGRAM_BINS = 20

const clamp01 = (x) => Math.min(1, Math.max(0, x))

/**
 * Score every glacier against a Mars profile.
 * @returns {{ values, shift, cellSims: Float64Array, cellScore: Float64Array, score: Float32Array,
 *            order: Uint32Array, rank: Uint32Array, mean, median, max, histogram: number[] }}
 */
export function scoreProfile(data, marsValues) {
  const { params, cells, glaciers, totalWeight } = data
  const nP = params.length
  const shift = params.map((p) => Math.log(p.mars / marsValues[p.key]))
  const cellSims = new Float64Array(cells.length * nP)
  const cellScore = new Float64Array(cells.length)
  for (let c = 0; c < cells.length; c++) {
    let acc = 0
    for (let k = 0; k < nP; k++) {
      const p = params[k]
      const d = Math.abs(cells[c].logRatio[k] + shift[k])
      const s = clamp01(1 - (d - p.lo) / (p.hi - p.lo))
      cellSims[c * nP + k] = s
      acc += p.weight * s
    }
    cellScore[c] = (100 * acc) / totalWeight
  }

  const n = glaciers.length
  const score = new Float32Array(n)
  for (let i = 0; i < n; i++) score[i] = cellScore[glaciers[i].cell]
  // Ties (glaciers sharing a climate cell) are broken by the pipeline's absolute score, which
  // also carries the soil thermal model, then by data completeness.
  const order = Uint32Array.from({ length: n }, (_, i) => i).sort(
    (a, b) =>
      score[b] - score[a] ||
      glaciers[b].absolute - glaciers[a].absolute ||
      glaciers[a].thermal - glaciers[b].thermal ||
      (glaciers[a].id < glaciers[b].id ? -1 : 1),
  )
  const rank = new Uint32Array(n)
  for (let k = 0; k < n; k++) rank[order[k]] = k
  const histogram = new Array(HISTOGRAM_BINS).fill(0)
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += score[i]
    histogram[Math.min(HISTOGRAM_BINS - 1, Math.floor((score[i] / 100) * HISTOGRAM_BINS))] += 1
  }
  return {
    values: marsValues,
    shift,
    cellSims,
    cellScore,
    score,
    order,
    rank,
    mean: sum / n,
    median: score[order[Math.floor(n / 2)]],
    max: score[order[0]],
    histogram,
  }
}

/** Per-parameter and per-stage comparison of one glacier against the scored Mars profile. */
export function compareGlacier(data, scoring, index) {
  const { params, cells, glaciers, totalWeight } = data
  const g = glaciers[index]
  const cell = cells[g.cell]
  const nP = params.length
  const rows = params.map((p, k) => {
    const logRatio = cell.logRatio[k] + scoring.shift[k]
    const sim = scoring.cellSims[g.cell * nP + k]
    return {
      key: p.key,
      stage: p.stage,
      weight: p.weight,
      earth: cell.earth[k],
      mars: scoring.values[p.key],
      logRatio,
      distance: Math.abs(logRatio),
      lo: p.lo,
      hi: p.hi,
      sim,
      points: (100 * p.weight * sim) / totalWeight,
      maxPoints: (100 * p.weight) / totalWeight,
      ...PARAM_INFO[p.key],
    }
  })
  const stages = []
  for (const r of rows) {
    let s = stages.find((x) => x.key === r.stage)
    if (!s) {
      s = { key: r.stage, ...STAGE_INFO[r.stage], weight: 0, points: 0, maxPoints: 0 }
      stages.push(s)
    }
    s.weight += r.weight
    s.points += r.points
    s.maxPoints += r.maxPoints
  }
  for (const s of stages) s.sim = s.points / s.maxPoints
  const n = glaciers.length
  const rank = scoring.rank[index]
  return {
    glacier: g,
    rows,
    stages,
    score: scoring.score[index],
    rank: rank + 1,
    percentile: 100 * (1 - rank / n),
    total: n,
  }
}

/**
 * Rank the sectors of the Andes by their best ice, then by their mean match. Each entry carries its
 * best glaciers ("best ices") and the survey-grid points linked to its glaciers.
 */
export function rankSectors(data, scoring, topPerSector = 3) {
  const { glaciers, survey, sectors } = data
  const acc = sectors.map((s) => ({ sector: s, count: 0, sum: 0, above70: 0, top: [], surveySet: new Set() }))
  for (const i of scoring.order) {
    const g = glaciers[i]
    const a = acc[g.sector.index]
    a.count += 1
    a.sum += scoring.score[i]
    if (scoring.score[i] >= 70) a.above70 += 1
    if (a.top.length < topPerSector) a.top.push(i)
    if (g.surveyIndex >= 0 && g.surveyKm <= 60) a.surveySet.add(g.surveyIndex)
  }
  return acc
    .filter((a) => a.count > 0)
    .map((a) => {
      const pts = [...a.surveySet].map((j) => survey[j])
      const inDomain = pts.filter((p) => p.thermal === 0)
      return {
        sector: a.sector,
        count: a.count,
        best: scoring.score[a.top[0]],
        mean: a.sum / a.count,
        shareAbove70: a.above70 / a.count,
        top: a.top,
        surveyCount: pts.length,
        surveyInDomain: inDomain.length,
        surveyMean: inDomain.length ? inDomain.reduce((s, p) => s + p.absolute, 0) / inDomain.length : null,
      }
    })
    .sort((x, y) => y.best - x.best || y.mean - x.mean)
}

/**
 * The best ice bodies for this Mars profile: the best glacier of each distinct climate cell, in rank
 * order (glaciers sharing a cell share every Earth value and therefore the score). `cellSize` is the
 * number of inventoried glaciers in that cell.
 */
export function bestIces(data, scoring, n = 10) {
  const { glaciers } = data
  let sizes = cellSizes.get(data)
  if (!sizes) {
    sizes = new Map()
    for (const g of glaciers) sizes.set(g.cell, (sizes.get(g.cell) ?? 0) + 1)
    cellSizes.set(data, sizes)
  }
  const seen = new Set()
  const out = []
  for (const i of scoring.order) {
    const c = glaciers[i].cell
    if (seen.has(c)) continue
    seen.add(c)
    out.push({ index: i, glacier: glaciers[i], score: scoring.score[i], rank: scoring.rank[i] + 1, cellSize: sizes.get(c) })
    if (out.length === n) break
  }
  return out
}
const cellSizes = new WeakMap()

/** Best survey points that have inventoried ice nearby, each with its best glacier (ranked by match). */
export function rankSurveyPoints(data, scoring, { maxKm = 40, limit = 8 } = {}) {
  const { glaciers, survey } = data
  const bestFor = new Map()
  for (const i of scoring.order) {
    const g = glaciers[i]
    if (g.surveyIndex < 0 || g.surveyKm > maxKm) continue
    const entry = bestFor.get(g.surveyIndex)
    if (!entry) bestFor.set(g.surveyIndex, { best: i, count: 1 })
    else entry.count += 1
  }
  return [...bestFor.entries()]
    .map(([j, e]) => ({ point: survey[j], glacier: glaciers[e.best], glacierScore: scoring.score[e.best], count: e.count }))
    .filter((e) => e.point.thermal === 0)
    .sort((a, b) => b.glacierScore - a.glacierScore || b.point.absolute - a.point.absolute)
    .slice(0, limit)
}

/** Formatting helpers shared by the HUD. */
export function formatValue(v, digits) {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-US')
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function formatRatio(earth, mars) {
  if (!(earth > 0) || !(mars > 0)) return '—'
  const r = earth / mars
  return r >= 10 ? `×${Math.round(r)}` : `×${r.toFixed(2)}`
}

export const pct = (v, d = 1) => (Number.isFinite(v) ? `${v.toFixed(d)}%` : '—')
