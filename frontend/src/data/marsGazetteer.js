/**
 * Subset of the IAU/USGS Gazetteer of Planetary Nomenclature (https://planetarynames.wr.usgs.gov)
 * covering every cluster of the Souness et al. (2012) glacier-like-form inventory.
 *
 * Coordinates: current MDIM 2.1 control network, planetocentric latitude (+N), EAST longitude
 * converted to -180..180. `diameterKm` is the IAU feature diameter. `id` is the gazetteer Feature id.
 *
 * `regional: true` marks broad terrae / planitiae used only as a fallback. `bbox` (where known) is
 * the gazetteer extent { n, s, w, e } in degrees (east longitudes, -180..180).
 */
export const MARS_GAZETTEER = [
  // ── Northern dichotomy boundary: Deuteronilus / Protonilus / Nilosyrtis Mensae ──────────────
  { id: 1509, name: 'Deuteronilus Mensae', type: 'Mensae', lat: 45.11, lon: 23.92, diameterKm: 919.17 },
  { id: 4852, name: 'Protonilus Mensae', type: 'Mensae', lat: 43.87, lon: 48.86, diameterKm: 1033.97 },
  { id: 4279, name: 'Nilosyrtis Mensae', type: 'Mensae', lat: 34.77, lon: 68.47, diameterKm: 676.03 },
  { id: 1272, name: 'Coloe Fossae', type: 'Fossae', lat: 36.65, lon: 56.78, diameterKm: 575.89 },
  { id: 2741, name: 'Ismeniae Fossae', type: 'Fossae', lat: 41.31, lon: 38.35, diameterKm: 286.91 },
  { id: 4035, name: 'Moreux crater', type: 'Crater', lat: 41.79, lon: 44.54, diameterKm: 131.55 },
  { id: 3618, name: 'Mamers Valles', type: 'Valles', lat: 40.65, lon: 17.94, diameterKm: 1020 },
  { id: 3538, name: 'Lyot crater', type: 'Crater', lat: 50.47, lon: 29.34, diameterKm: 221.53 },
  { id: 1270, name: 'Colles Nili', type: 'Colles', lat: 38.72, lon: 62.88, diameterKm: 653.67 },
  { id: 4992, name: 'Renaudot crater', type: 'Crater', lat: 42.04, lon: 62.68, diameterKm: 63.74 },
  { id: 471, name: 'Auqakuh Vallis', type: 'Vallis', lat: 30.25, lon: 60.41, diameterKm: 347 },
  { id: 4271, name: 'Nili Fossae', type: 'Fossae', lat: 22.02, lon: 76.69, diameterKm: 727.91 },
  { id: 6261, name: 'Utopia Rupes', type: 'Rupes', lat: 43.53, lon: 86.03, diameterKm: 2492.68 },
  { id: 1367, name: 'Cydonia Mensae', type: 'Mensae', lat: 34.56, lon: -12.33, diameterKm: 764.96 },
  { id: 1365, name: 'Cydonia Colles', type: 'Colles', lat: 39.07, lon: -12.22, diameterKm: 362.78 },
  { id: 3136, name: 'Kufra crater', type: 'Crater', lat: 40.36, lon: 120.3, diameterKm: 37.48 },

  // ── Phlegra Montes / Erebus Montes / Acheron Fossae ─────────────────────────────────────────
  { id: 4701, name: 'Phlegra Montes', type: 'Montes', lat: 40.4, lon: 163.71, diameterKm: 1350.65 },
  { id: 1821, name: 'Erebus Montes', type: 'Montes', lat: 35.66, lon: -174.98, diameterKm: 811.67 },
  { id: 5874, name: 'Tartarus Colles', type: 'Colles', lat: 21.24, lon: 175.19, diameterKm: 1672.69 },
  { id: 35, name: 'Acheron Fossae', type: 'Fossae', lat: 38.27, lon: -135.02, diameterKm: 703.11 },
  { id: 3529, name: 'Lycus Sulci', type: 'Sulci', lat: 28.14, lon: -144.47, diameterKm: 1350.61 },

  // ── Tempe Terra region ──────────────────────────────────────────────────────────────────────
  { id: 3695, name: 'Mareotis Fossae', type: 'Fossae', lat: 44.34, lon: -76.12, diameterKm: 1907.94 },
  { id: 419, name: 'Ascuris Planum', type: 'Planum', lat: 40.59, lon: -80.78, diameterKm: 617.66 },
  { id: 5849, name: 'Tanaica Montes', type: 'Montes', lat: 39.55, lon: -90.83, diameterKm: 178.55 },
  { id: 5860, name: 'Tantalus Fossae', type: 'Fossae', lat: 49.83, lon: -96.09, diameterKm: 2361.86 },

  // ── Eastern Hellas rim (SHARAD buried-ice LDAs, Holt et al. 2008) ───────────────────────────
  { id: 5006, name: 'Reull Vallis', type: 'Vallis', lat: -42.14, lon: 104.95, diameterKm: 1051.94 },
  { id: 2431, name: 'Hellas Montes', type: 'Montes', lat: -37.63, lon: 97.61, diameterKm: 159.65 },
  { id: 1100, name: 'Centauri Montes', type: 'Montes', lat: -38.67, lon: 95.52, diameterKm: 271 },
  { id: 1873, name: 'Euripus Mons', type: 'Mons', lat: -44.82, lon: 105.18, diameterKm: 88.91 },
  { id: 14743, name: 'Greg crater', type: 'Crater', lat: -38.59, lon: 112.89, diameterKm: 68.12 },
  { id: 14745, name: 'Waikato Vallis', type: 'Vallis', lat: -33.33, lon: 113.78, diameterKm: 228.03 },
  { id: 1409, name: 'Dao Vallis', type: 'Vallis', lat: -37.61, lon: 88.89, diameterKm: 794 },

  // ── Western Hellas rim & Noachis Terra craters ──────────────────────────────────────────────
  { id: 2435, name: 'Hellespontus Montes', type: 'Montes', lat: -44.37, lon: 42.76, diameterKm: 711.46 },
  { id: 4829, name: 'Proctor crater', type: 'Crater', lat: -47.63, lon: 29.72, diameterKm: 172.56 },
  { id: 16377, name: 'Minami crater', type: 'Crater', lat: -37.49, lon: 33.17, diameterKm: 80 },
  { id: 15313, name: 'Greeley crater', type: 'Crater', lat: -36.79, lon: 3.92, diameterKm: 457.45 },
  { id: 3314, name: 'Le Verrier crater', type: 'Crater', lat: -37.71, lon: 17.1, diameterKm: 137.55 },
  { id: 2890, name: 'Kaiser crater', type: 'Crater', lat: -46.19, lon: 19.11, diameterKm: 201.67 },

  // ── Argyre rim ──────────────────────────────────────────────────────────────────────────────
  { id: 4214, name: 'Nereidum Montes', type: 'Montes', lat: -37.57, lon: -43.21, diameterKm: 1142.58 },
  { id: 1149, name: 'Charitum Montes', type: 'Montes', lat: -58.1, lon: -40.29, diameterKm: 933.54 },
  { id: 2331, name: 'Halley crater', type: 'Crater', lat: -48.34, lon: -59.27, diameterKm: 83.72 },
  { id: 835, name: 'Bosporos Rupes', type: 'Rupes', lat: -42.74, lon: -57.55, diameterKm: 531.42 },

  // ── Southern highlands west of Argyre / Terra Sirenum ───────────────────────────────────────
  { id: 3494, name: 'Lowell crater', type: 'Crater', lat: -51.96, lon: -81.5, diameterKm: 202.22 },
  { id: 532, name: 'Babakin crater', type: 'Crater', lat: -36.0, lon: -71.44, diameterKm: 76.66 },
  { id: 6491, name: 'Warrego Valles', type: 'Valles', lat: -41.84, lon: -92.15, diameterKm: 205.08 },
  { id: 2640, name: 'Icaria Fossae', type: 'Fossae', lat: -48.09, lon: -125.16, diameterKm: 2115.45 },
  { id: 3379, name: 'Li Fan crater', type: 'Crater', lat: -46.88, lon: -153.06, diameterKm: 105.58 },

  // ── Regional fallbacks (terrae / planitiae) ─────────────────────────────────────────────────
  { id: 14779, name: 'Eridania Planitia', type: 'Planitia', lat: -38.15, lon: 122.21, diameterKm: 1062.13, regional: true, bbox: { n: -32.65, s: -43.97, w: 111.03, e: 133.12 } },
  { id: 371, name: 'Argyre Planitia', type: 'Planitia', lat: -49.84, lon: -43.31, diameterKm: 892.93, regional: true, bbox: { n: -42.44, s: -57.29, w: -53.88, e: -33.38 } },
  { id: 2432, name: 'Hellas Planitia', type: 'Planitia', lat: -42.43, lon: 70.5, diameterKm: 2299.16, regional: true, bbox: { n: -27.86, s: -55.42, w: 45.58, e: 96.12 } },
  { id: 4835, name: 'Promethei Terra', type: 'Terra', lat: -64.37, lon: 97.0, diameterKm: 3244.3, regional: true, bbox: { n: -26.71, s: -82.86, w: 29.62, e: 129.3 } },
  { id: 311, name: 'Aonia Terra', type: 'Terra', lat: -60.2, lon: -97.05, diameterKm: 3873.48, regional: true, bbox: { n: -30.8, s: -80.54, w: -162.88, e: -60.25 } },
  { id: 5932, name: 'Terra Sirenum', type: 'Terra', lat: -39.49, lon: -154.15, diameterKm: 3635.18, regional: true, bbox: { n: -11.4, s: -67.57, w: -180, e: -110.32 } },
  { id: 4319, name: 'Noachis Terra', type: 'Terra', lat: -50.41, lon: -5.16, diameterKm: 5519.45, regional: true, bbox: { n: -2.53, s: -83.6, w: -59.96, e: 74.61 } },
  { id: 5930, name: 'Terra Cimmeria', type: 'Terra', lat: -32.68, lon: 147.75, diameterKm: 5855.87, regional: true, bbox: { n: 12.13, s: -73.54, w: 98.79, e: 180 } }, // extents snapped to ±180 to close the antimeridian gap
  { id: 5916, name: 'Tempe Terra', type: 'Terra', lat: 38.69, lon: -70.61, diameterKm: 1954.94, regional: true },
  { id: 348, name: 'Arcadia Planitia', type: 'Planitia', lat: 49.02, lon: -171.85, diameterKm: 2245, regional: true },
  { id: 6260, name: 'Utopia Planitia', type: 'Planitia', lat: 46.74, lon: 117.52, diameterKm: 3560.45, regional: true },
  { id: 38, name: 'Acidalia Planitia', type: 'Planitia', lat: 49.76, lon: -20.74, diameterKm: 3505, regional: true },
  { id: 336, name: 'Arabia Terra', type: 'Terra', lat: 21.25, lon: 5.72, diameterKm: 4851.74, regional: true },
]

export const GAZETTEER_SOURCE = 'IAU/USGS Gazetteer of Planetary Nomenclature (MDIM 2.1)'
