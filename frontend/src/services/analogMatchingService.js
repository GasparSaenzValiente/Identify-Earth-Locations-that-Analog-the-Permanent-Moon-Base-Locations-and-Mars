/**
 * Analog matching service — Mars site → best Andean glacier.
 *
 * 1. Build the site's Mars surface profile (lib/marsEnvironment.js): the pipeline's reference
 *    profile moved to the site's latitude and MOLA elevation.
 * 2. Score all 7,719 inventoried Andean glaciers against it with the pipeline's own similarity
 *    method (lib/analogScoring.js) — and, for comparison, against the unmodified reference profile.
 * 3. The best-ranked glacier is the analog.
 *
 * Optional backend: set VITE_ANALOG_API_URL and the service POSTs the site to `/match` first; a
 * response whose `analog.id` is an inventory id overrides the local pick. Any error falls back to
 * the local scoring.
 */
import mock from '../data/mockAnalogMatches.json'
import { MARS_RADIUS_KM } from '../config/scene'
import { greatCircleKm } from '../lib/geo'
import { marsSiteProfile } from '../lib/marsEnvironment'
import { scoreProfile } from '../lib/analogScoring'
import { loadAndesData } from './andesDataService'

/**
 * @typedef {Object} MarsSite
 * @property {string} id
 * @property {string} name
 * @property {number} lat  planetocentric latitude, degrees
 * @property {number} lon  east longitude, degrees (-180..180)
 * @property {'glf'|'reference'} [kind]
 *
 * @typedef {Object} AnalogMatch
 * @property {MarsSite} marsSite
 * @property {'site-adjusted'|'backend'} method
 * @property {{ site: object, reference: object }} profiles   Mars profiles (values + inputs)
 * @property {{ site: object, reference: object }} scorings   scoreProfile() results
 * @property {number} analogIndex                             index into the glacier inventory
 * @property {object} analog                                  the inventory glacier record
 * @property {number} score                                   site-adjusted match, 0–100
 */

export const MARS_REFERENCE_SITES = mock.mars_glaciers.map((s) => ({ ...s, kind: 'reference' }))

const API_URL = import.meta.env.VITE_ANALOG_API_URL
const NEIGHBOUR_KM = 300

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve()
    const id = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function summarizeSite(site) {
  return { id: site.id, name: site.name, lat: site.lat, lon: site.lon, kind: site.kind ?? 'glf', number: site.number }
}

/** A GLF carries its own MOLA buffer elevation; a reference site borrows its GLF neighbours'. */
export function siteElevation(site, glfItems = []) {
  if (site.kind !== 'reference' && Number.isFinite(site.elevation?.mean)) {
    return { elevationM: site.elevation.mean, elevationSource: 'glf' }
  }
  const near = glfItems.filter((g) => Number.isFinite(g.elevation?.mean) && greatCircleKm(site, g, MARS_RADIUS_KM) <= NEIGHBOUR_KM)
  if (!near.length) return { elevationM: null, elevationSource: 'reference' }
  return { elevationM: near.reduce((a, g) => a + g.elevation.mean, 0) / near.length, elevationSource: `${near.length} GLFs ≤ ${NEIGHBOUR_KM} km` }
}

let referenceScoring = null

/** Synchronous scoring once the dataset is loaded (also used by the HUD for hover previews). */
export function matchSite(data, site, glfItems) {
  const { elevationM, elevationSource } = siteElevation(site, glfItems)
  const siteProfile = marsSiteProfile({ lat: site.lat, elevationM, elevationSource }, data.reference)
  const referenceProfile = { values: data.reference, insolationRatio: 1, elevationM: null, elevationSource: 'reference' }
  referenceScoring ??= scoreProfile(data, data.reference)
  const scorings = { site: scoreProfile(data, siteProfile.values), reference: referenceScoring }
  const analogIndex = scorings.site.order[0]
  return {
    marsSite: summarizeSite(site),
    method: 'site-adjusted',
    profiles: { site: siteProfile, reference: referenceProfile },
    scorings,
    analogIndex,
    analog: data.glaciers[analogIndex],
    score: scorings.site.score[analogIndex],
  }
}

async function backendPick(site, signal) {
  const res = await fetch(`${API_URL.replace(/\/$/, '')}/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mars_site: summarizeSite(site) }),
    signal,
  })
  if (!res.ok) throw new Error(`analog backend responded ${res.status}`)
  const body = await res.json()
  return typeof body?.analog?.id === 'string' ? body.analog.id : null
}

/**
 * Find the best Andean glacier analog for a Martian site.
 * @param {MarsSite & Record<string, unknown>} site
 * @param {{ signal?: AbortSignal, latencyMs?: number, glfItems?: object[] }} [options]
 * @returns {Promise<AnalogMatch>}
 */
export async function findBestAnalog(site, { signal, latencyMs = 1100, glfItems = [] } = {}) {
  const started = performance.now()
  const data = await loadAndesData()
  throwIfAborted(signal)
  const match = matchSite(data, site, glfItems)
  if (API_URL) {
    try {
      const id = await backendPick(site, signal)
      const hit = id && data.glaciers.find((g) => g.id === id)
      if (hit) Object.assign(match, { method: 'backend', analogIndex: hit.index, analog: hit, score: match.scorings.site.score[hit.index] })
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      console.warn('[analogMatchingService] backend unavailable, using local scoring:', err)
    }
  }
  // Keep the search read-out on screen long enough to be read.
  await delay(latencyMs - (performance.now() - started), signal)
  return match
}
