/**
 * Local surface environment of a Martian site, derived from the pipeline's reference profile.
 *
 * The coincidence pipeline compares every Andean glacier with ONE Mars profile (z₀, T, p, ρ, wind,
 * irradiance). That profile is treated here as the environment of the mean glacier-like-form site —
 * the Souness et al. (2012) inventory has a mean |latitude| of 39.9° — and is moved to any other
 * site with first-order physics:
 *
 *   irradiance  ∝ annual-mean top-of-atmosphere insolation at the site's latitude
 *                 (Mars obliquity 25.19°; the annual mean is hemispherically symmetric)
 *   temperature ∝ irradiance^¼ (radiative-equilibrium scaling)
 *   pressure    = 610 Pa · exp(−z / 11.1 km)  (MOLA datum pressure, CO₂ scale height)
 *   density     ∝ p / T (ideal gas, anchored on the reference ρ)
 *   wind, z₀    held at the reference values
 */
import { clamp01 } from './math'

const DEG = Math.PI / 180
export const MARS_OBLIQUITY_DEG = 25.19
export const MARS_DATUM_PRESSURE_PA = 610
export const MARS_SCALE_HEIGHT_M = 11100
export const REFERENCE_LATITUDE = 40

/** Daily-mean insolation at unit distance, in units of S/π (Berger's formula). */
function dailyFactor(phi, decl) {
  const x = -Math.tan(phi) * Math.tan(decl)
  const h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x)
  return h0 * Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.sin(h0)
}

const cache = new Map()
/** Annual-mean insolation factor (relative units) at a latitude in degrees. */
export function annualInsolation(latDeg) {
  const key = Math.round(Math.abs(latDeg) * 10)
  if (cache.has(key)) return cache.get(key)
  const phi = Math.min(89.9, key / 10) * DEG
  const eps = MARS_OBLIQUITY_DEG * DEG
  const N = 360
  let sum = 0
  for (let i = 0; i < N; i++) {
    const ls = ((i + 0.5) / N) * 2 * Math.PI
    sum += dailyFactor(phi, Math.asin(Math.sin(eps) * Math.sin(ls)))
  }
  const q = sum / N
  cache.set(key, q)
  return q
}

/** Elevation at which the scale-height model gives the reference pressure (≈ −2.3 km). */
export function referenceElevationM(referencePressurePa) {
  return -MARS_SCALE_HEIGHT_M * Math.log(referencePressurePa / MARS_DATUM_PRESSURE_PA)
}

/**
 * @param {{ lat: number, elevationM?: number|null }} site
 * @param {Record<string, number>} reference  pipeline Mars values keyed by parameter
 * @returns {{ values: Record<string, number>, insolationRatio: number, elevationM: number|null, elevationSource: string }}
 */
export function marsSiteProfile({ lat, elevationM = null, elevationSource = 'glf' }, reference) {
  const q = annualInsolation(lat) / annualInsolation(REFERENCE_LATITUDE)
  const t = reference.t_superficie * q ** 0.25
  const hasZ = Number.isFinite(elevationM)
  const p = hasZ ? MARS_DATUM_PRESSURE_PA * Math.exp(-elevationM / MARS_SCALE_HEIGHT_M) : reference.p_superficie
  const rho = reference.rho_aire * (p / reference.p_superficie) * (reference.t_superficie / t)
  return {
    values: {
      z0: reference.z0,
      t_superficie: t,
      p_superficie: p,
      rho_aire: rho,
      viento_10m: reference.viento_10m,
      solar: reference.solar * q,
    },
    insolationRatio: q,
    elevationM: hasZ ? elevationM : referenceElevationM(reference.p_superficie),
    elevationSource: hasZ ? elevationSource : 'reference',
  }
}

/** 0..1 position of a value inside a display range (used by the HUD bars). */
export const rangeT = (v, lo, hi) => clamp01((v - lo) / (hi - lo))
