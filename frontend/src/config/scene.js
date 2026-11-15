import { Vector3 } from 'three'

/**
 * Scene-wide constants. One scene unit = one Mars radius.
 * Planet sizes are to scale relative to each other; the Mars–Earth distance is not
 * (it is compressed so the camera can travel between them in a few seconds).
 *
 * NOTE: the Vector3 constants below are shared — never mutate them, always .clone() / .copy() from them.
 */
export const MARS_RADIUS_KM = 3389.5
export const EARTH_RADIUS_KM = 6371.0

export const MARS_RADIUS = 1
export const EARTH_RADIUS = EARTH_RADIUS_KM / MARS_RADIUS_KM // ≈ 1.88

export const MARS_CENTER = new Vector3(0, 0, 0)
// ~45 units apart: far enough to feel like a journey, close enough that the destination is a
// visible disc for most of the cruise (a longer gap left seconds of near-black screen mid-flight).
export const EARTH_CENTER = new Vector3(-28, 6, -35)

export const PLANETS = {
  mars: { key: 'mars', label: 'Mars', center: MARS_CENTER, radius: MARS_RADIUS, radiusKm: MARS_RADIUS_KM },
  earth: { key: 'earth', label: 'Earth', center: EARTH_CENTER, radius: EARTH_RADIUS, radiusKm: EARTH_RADIUS_KM },
}

export const CAMERA = {
  fov: 42,
  near: 0.005,
  far: 2500,
  /** Opening shot: start far away and glide in towards Mars. */
  introFrom: [3.4, 4.6, 19],
  introTo: [1.45, 1.15, 3.6],
}

export const CONTROLS = {
  mars: { min: 1.2, max: 12 },
  // min stays just outside the atmosphere halo shell (1.06 R) and above the point where the global
  // basemap is magnified into blur
  earth: { min: EARTH_RADIUS * 1.07, max: EARTH_RADIUS * 7 },
}

export const FLIGHT = {
  /** Distance from Mars' center when the camera first frames the clicked glacier. */
  focusDistance: 2.35,
  focusDuration: 1.3,
  /** Mars → Earth flight. */
  duration: 7.2,
  /** Flights spend little time in the empty cruise and linger near the planets. */
  ease: 'power3.inOut',
  departureRadii: 5.5,
  arrivalRadii: 5.0,
  /** Final camera distance from Earth's center, in Earth radii (≈ 830 km altitude). */
  earthFinalRadii: 1.13,
  /** Earth → Mars flight. */
  returnDuration: 6.4,
  marsReturnDistance: 2.6,
  /** Mars-local camera moves (region focus). */
  regionDuration: 1.7,
  regionDistance: 2.05,
  /** Earth-local camera moves (re-centring on another Andean glacier). */
  earthHopDuration: 1.25,
}

/** Andean glacier / survey-grid markers on Earth (screen-size constant: radius ∝ camera altitude). */
export const EARTH_MARKERS = {
  altitude: 1.0012,
  glacierPerAltitude: 0.0042,
  surveyPerAltitude: 0.0068,
  minScale: 0.00045,
  maxScale: 0.03,
  pickPx: 11,
}

/** Mars Reconnaissance Orbiter (carries SHARAD). Orbit radius is exaggerated so it reads at globe scale. */
export const SHARAD = {
  orbitRadius: 1.36,
  periodSec: 28,
  inclinationDeg: 92.6, // MRO: near-polar, sun-synchronous
  nodeDeg: 38,
}

export const MARKERS = {
  altitude: 1.0035, // marker centers sit just above the surface (in planet radii)
  minScale: 0.0055,
  maxScale: 0.02,
}

/** SHARAD sweep: progress runs 0 → SCAN_END radians around the planet. */
export const SCAN_END = Math.PI * 2 + 0.55
export const SCAN_DURATION = 3.4

export const MEAN_EARTH_MARS_DISTANCE_KM = 225e6
export const SPEED_OF_LIGHT_KMS = 299792.458

/**
 * Sun intensity per planet. three.js lights are physically based (diffuse = albedo·I·N·L/π), and
 * the NASA Blue Marble mosaic is far darker than the Viking Mars mosaic (oceans/forests ≈ 1–3 %
 * reflectance), so Earth needs more light plus a small self-illumination fill to never read as black.
 */
export const LIGHTING = {
  marsSun: 2.1,
  earthSun: 3.6,
  earthFill: 0.3, // emissive fraction of the Earth basemap
}

export const COLORS = {
  ice: '#00ccff', // the GLF inventory's own fill colour (jC_fillclr "0 204 255")
  iceWhite: '#e9fbff',
  amber: '#ffb347',
  marsHaze: '#ffb08a',
  earthHaze: '#5ea8ff',
}
