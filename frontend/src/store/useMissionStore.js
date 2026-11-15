import { create } from 'zustand'
import { findBestAnalog, MARS_REFERENCE_SITES } from '../services/analogMatchingService'
import { loadAndesData } from '../services/andesDataService'
import { loadGlacierLikeForms, summarizeRegions } from '../services/glfDataService'

const MATCH_TIMEOUT_MS = 10000
let inflight = null // AbortController of the current analog request

/**
 * Mission state machine.
 *
 *   intro ──(click SHARAD)──▶ scanning ──(sweep done)──▶ mars
 *   mars ──(click glacier)──▶ matching ──(analog + focus done)──▶ confirm
 *   confirm ──(launch)──▶ transit ──▶ earth        confirm/matching ──(abort)──▶ mars
 *   earth ──(back)──▶ returning ──▶ mars           earth ──(pick glacier)──▶ earth (re-centred)
 *
 * `activePlanet` flips when a flight lands. Camera choreography lives in <CameraDirector/>,
 * which subscribes to these transitions; components never move the camera themselves.
 */
export const useMissionStore = create((set, get) => ({
  phase: 'intro',
  activePlanet: 'mars',

  glf: { status: 'idle', items: [], regions: [], error: null },
  referenceSites: MARS_REFERENCE_SITES,
  /** Andean inventory + survey grid with the coincidence-pipeline results (see andesDataService). */
  andes: { status: 'idle', data: null, error: null },

  // Earth view options
  earthProfile: 'site', // 'site' (this Martian site's conditions) | 'reference' (pipeline profile)
  earthColor: 'match', // 'match' | 'absolute'
  earthLayers: { glaciers: true, survey: true },
  earthPanelOpen: null, // null → decided by screen width on first show

  hovered: null,
  selectedMarsSite: null,
  selectedAnalog: null,
  matchError: null,

  colorMode: 'area', // 'area' | 'elevation'
  basemap: 'viking', // 'viking' | 'mola'
  textureSources: { mars: 'procedural', earth: 'procedural' },
  focusRequest: null,

  /** Action 1 — click on the SHARAD orbiter: start the sweep and load the GLF inventory. */
  activateSharad: async () => {
    const { glf, phase } = get()
    if (phase !== 'intro' || glf.status === 'loading' || glf.status === 'ready') return
    set({ phase: 'scanning', glf: { ...glf, status: 'loading', error: null } })
    get().loadAndes() // prefetch the Earth side while the sweep runs
    try {
      const items = await loadGlacierLikeForms()
      set({ glf: { status: 'ready', items, regions: summarizeRegions(items), error: null } })
    } catch (err) {
      console.error(err)
      set({ phase: 'intro', glf: { status: 'error', items: [], regions: [], error: err.message } })
    }
  },

  finishScan: () => {
    if (get().phase === 'scanning') set({ phase: 'mars' })
  },

  loadAndes: async () => {
    const { andes } = get()
    if (andes.status === 'loading' || andes.status === 'ready') return
    set({ andes: { status: 'loading', data: null, error: null } })
    try {
      const data = await loadAndesData()
      set({ andes: { status: 'ready', data, error: null } })
    } catch (err) {
      console.error(err)
      set({ andes: { status: 'error', data: null, error: err.message } })
    }
  },

  /** Action 2 — hover. Accepts a GLF record, a reference site, or null. */
  setHovered: (site) => {
    if ((get().hovered?.id ?? null) !== (site?.id ?? null)) set({ hovered: site })
  },

  /** Action 3 — click a Martian site: score the Andean inventory against its conditions. */
  selectMarsSite: (site) => {
    if (!site || get().phase !== 'mars') return
    set({ selectedMarsSite: site, selectedAnalog: null, matchError: null, hovered: null, phase: 'matching', earthProfile: 'site' })
    get().loadAndes()
    // One request at a time: a new selection or an abort cancels the previous one, and only the
    // current request may write results. A slow backend gives up after MATCH_TIMEOUT_MS.
    inflight?.abort()
    const controller = new AbortController()
    inflight = controller
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, MATCH_TIMEOUT_MS)
    findBestAnalog(site, { signal: controller.signal, glfItems: get().glf.items })
      .then((match) => {
        if (inflight !== controller) return
        const s = get()
        if (s.phase === 'matching' && s.selectedMarsSite?.id === site.id) set({ selectedAnalog: match })
      })
      .catch((err) => {
        if (inflight !== controller) return
        if (err?.name === 'AbortError' && !timedOut) return // cancelled by the user
        const s = get()
        if (s.selectedMarsSite?.id !== site.id || s.phase !== 'matching') return
        console.error(err)
        const message = timedOut ? 'The analog-matching service timed out. Try again.' : err?.message
        set({ phase: 'mars', matchError: message ?? 'Analog matching failed' })
      })
      .finally(() => {
        clearTimeout(timer)
        if (inflight === controller) inflight = null
      })
  },

  /** Camera has framed the glacier and the analog is known: wait for the user to launch. */
  awaitConfirm: () => {
    if (get().phase === 'matching') set({ phase: 'confirm', hovered: null })
  },
  confirmTravel: () => {
    if (get().phase === 'confirm') set({ phase: 'transit', hovered: null })
  },
  cancelTravel: () => {
    if (['matching', 'confirm'].includes(get().phase)) {
      inflight?.abort()
      inflight = null
      set({ phase: 'mars', selectedMarsSite: null, selectedAnalog: null, matchError: null })
    }
  },
  marsPanelOpen: null, // null → decided by screen width on first show
  setMarsPanelOpen: (open) => set({ marsPanelOpen: open }),
  arriveEarth: () => set({ phase: 'earth', activePlanet: 'earth' }),

  returnToMars: () => {
    if (get().phase !== 'earth') return
    set({ phase: 'returning', hovered: null })
  },
  arriveMars: () => set({ phase: 'mars', activePlanet: 'mars', selectedAnalog: null }),

  /** On Earth: compare another inventory glacier (the camera re-centres on it). */
  selectEarthGlacier: (index) => {
    const { phase, selectedAnalog: m, andes } = get()
    const g = andes.data?.glaciers[index]
    if (phase !== 'earth' || !m || !g || m.analogIndex === index) return
    set({ selectedAnalog: { ...m, analogIndex: index, analog: g, score: m.scorings.site.score[index] }, hovered: null })
  },
  setEarthProfile: (earthProfile) => set({ earthProfile }),
  setEarthColor: (earthColor) => set({ earthColor }),
  toggleEarthLayer: (key) => set((s) => ({ earthLayers: { ...s.earthLayers, [key]: !s.earthLayers[key] } })),
  setEarthPanelOpen: (open) => set({ earthPanelOpen: open }),

  focusRegion: (lat, lon, distance) => {
    if (get().phase !== 'mars') return
    set({ focusRequest: { lat, lon, distance, nonce: Math.random() } })
  },

  setColorMode: (colorMode) => set({ colorMode }),
  setBasemap: (basemap) => set({ basemap }),
  setTextureSource: (planet, source) =>
    set((s) => (s.textureSources[planet] === source ? s : { textureSources: { ...s.textureSources, [planet]: source } })),
  dismissError: () =>
    set((s) => ({
      matchError: null,
      glf: { ...s.glf, error: null },
      // an Andes load failure is retried on the next selection
      andes: s.andes.status === 'error' ? { status: 'idle', data: null, error: null } : s.andes,
    })),
}))

/** The scoring the Earth view shows: this Martian site's conditions or the pipeline's reference. */
export const activeScoring = (s) => {
  const m = s.selectedAnalog
  if (!m?.scorings) return null
  return s.earthProfile === 'reference' ? m.scorings.reference : m.scorings.site
}

// Dev-only handle for debugging / automated checks in the browser console.
if (import.meta.env.DEV && typeof window !== 'undefined') window.__mission = useMissionStore
