# Mars ↔ Andes Glacier Analogs — frontend

NASA Space Apps Challenge 2026. A 3D web app that pairs Martian glacier-like forms with terrestrial
rock-glacier analogs in the Andes (IANIGLA inventory), to help simulate ice-extraction sites.

**Stack:** React 19 · Vite 8 · Tailwind CSS v4 · three.js · @react-three/fiber · @react-three/drei ·
@react-three/postprocessing · GSAP · Zustand

Requires Node.js 20.19+ or 22.12+ (Vite 8).

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production bundle in dist/
npm run data:andes   # rebuild public/data/andes_analogs.json from data/source/
```

- **Recording the demo:** open `http://localhost:5173/?capture`. This keeps the WebGL drawing buffer,
  so screen recorders and screenshot tools never capture black frames.
- **Dev server watcher:** the dev server polls for file changes (`vite.config.js`). Native file events
  were being dropped in this folder on Windows, which left stale modules being served.
- **Interaction:** it works with mouse, keyboard and touch. On touch screens the first tap previews a
  glacier and a second tap flies to it. With `prefers-reduced-motion`, flights are short and the warp
  effects are turned off.

## The flow

| Step | What happens | Where |
| --- | --- | --- |
| Scene 1 | Camera glides in to Mars. The SHARAD orbiter (MRO) circles on a near-polar orbit. You can orbit, zoom and pan. | `three/mars/MarsScene.jsx`, `three/mars/SharadSatellite.jsx` |
| Action 1 | Click SHARAD. A radar front sweeps around the planet from the orbiter's ground track. The GeoJSON is fetched and 1,309 glacier-like forms pop in as the front passes them. | `store.activateSharad`, `three/mars/ScanSweep.jsx`, `three/mars/GlacierMarkers.jsx` |
| Action 2 | Hover a marker to see a lightweight tooltip (IAU region name, GLF #, size, elevation). | `three/mars/GlacierTooltip.jsx` |
| Action 3 | Click a marker. The camera frames it while the 7,719 Andean glaciers are scored against that site's Mars conditions. A flight plan shows the best analog; *Launch to Earth* flies through space with warp streaks, a FOV kick and chromatic aberration. | `services/analogMatchingService.js`, `three/CameraDirector.jsx`, `ui/Popouts.jsx` |
| Scene 2 | The camera spirals in and zooms onto the analog. The inventory and the uniform survey grid ripple in, coloured by match. Hover any glacier to inspect it, click to compare it (the camera re-centres). The left panel ranks the Andes sectors with their best ices; the right panel is the full Mars ↔ Earth comparison. *Back to Mars* flies the reverse route. | `three/earth/*`, `ui/EarthPanel.jsx`, `ui/AnalogPanel.jsx` |

The two reference sites (`m1` Arcadia Planitia Base, `m2` Deuteronilus Mensae) appear as amber diamonds and
can be targeted from the left panel. The team's field benchmarks (Glaciar Morenas Coloradas, Glaciar Dos
Lenguas) are tagged on Earth on their inventory glacier, with their rank for the current site.

**Best ices for Mars.** On Earth, the left panel opens with the ten best ice bodies for the selected Martian
site: the best glacier of each distinct climate cell, in rank order. The top five are also tagged on the globe.
Below them, the Andes sectors are ranked with their three best glaciers each.

## Andean data and scoring

`data/source/` holds the two exports of the team's coincidence pipeline:

| File | Records | Content |
| --- | --- | --- |
| `resultados_coincidencia_glaciares.json` | 7,719 glaciers (ING ids) | six compared parameters per glacier, `porcentaje_coincidencia` (relative) and `porcentaje_absoluto` |
| `resultados_coincidencia.json` | 1,982 uniform survey points along the Andes (11°N–55°S) | no climate parameters; `porcentaje_absoluto` is non-zero only for the 813 points inside the soil thermal-model domain, so the app labels it a soil thermal score |

`npm run data:andes` packs them into `public/data/andes_analogs.json` (622 KB, 169 KB gzipped): 176 unique
climate cells, the glaciers and the survey grid in columnar form, and every glacier linked to its nearest
survey point. The script also recovers the pipeline's similarity curve and checks that it reproduces every
value of the dataset (max error 1e-14):

```
dₖ    = |ln(earthₖ / marsₖ)|
simₖ  = clamp01(1 − (dₖ − P5ₖ) / (P95ₖ − P5ₖ))       P5/P95 of dₖ over the 7,719 glaciers
match = 100 · Σ wₖ·simₖ / Σ wₖ                       E1 (z₀, T) w=2 · E3 (P, ρ) w=4 · E4 (U₁₀, S) w=5
```

This is a **relative** match (the pipeline's `relativo_comunes` criterion). 100 % means "as close to Mars
as the closest 5 % of the Andean inventory on every parameter", not "equal to Mars". The HUD therefore labels
it *REL %* (relative match). The Earth values are the pipeline's climate-cell values, shared by every glacier in the same
cell.

**Site-adjusted Mars profile** (`lib/marsEnvironment.js`). The pipeline compares every glacier with one Mars
profile (z₀ 0.0044 m, T 202 K, P 753 Pa, ρ 0.021 kg/m³, U₁₀ 6.7 m/s, S 104 W/m²). The app takes it as the
environment at the mean GLF latitude (40°; the Souness inventory's mean |lat| is 39.9°) and moves it to the
clicked site:

- S ∝ annual-mean insolation at the site's latitude (obliquity 25.19°);
- T ∝ S^¼;
- P = 610 Pa · exp(−z / 11.1 km) from the GLF's MOLA buffer elevation;
- ρ ∝ P / T;
- z₀ and U₁₀ are held.

All glaciers are re-scored with the same P5–P95 tolerance band, so the ranking changes with the site. For
example, deep Hellas GLFs (≈1,100 Pa) reach a relative match of 99.6 % in Patagonia, while 60°N sites
(187 K, 76 W/m²) top out near 71 %. The Earth panel switches between this profile and the pipeline reference, which reproduces the
dataset's own scores. Glaciers that share a climate cell share a score, and ties are broken by the
pipeline's absolute score.

**Sectors.** `data/andesGazetteer.js` lists 43 glaciated sectors (ranges, massifs, basins, ice fields) inside
the five ING regions. Each glacier joins the nearest sector, and sectors are ranked by their best glacier,
then by their mean.

## Architecture

```
src/
  config/scene.js              radii (true Mars:Earth ratio), positions, camera/flight tuning
  data/mockAnalogMatches.json  reference sites m1/m2 and their curated analogs (contract given by the team)
  data/marsGazetteer.js        IAU/USGS gazetteer subset (MDIM 2.1) used to name each GLF
  data/andesGazetteer.js       ING macro-regions + 43 glaciated sectors of the Argentine Andes
  services/
    analogMatchingService.js   Mars site → site profile → scored inventory → best analog
    andesDataService.js        loads/decodes andes_analogs.json, sector + benchmark assignment, pick grid
    glfDataService.js          GeoJSON loader + normaliser + region naming/summary
  lib/analogScoring.js         the pipeline's similarity, per-glacier comparison, sector/grid rankings
  lib/marsEnvironment.js       Mars site conditions (insolation, temperature, pressure, density)
  store/useMissionStore.js     Zustand phase machine: activePlanet, selectedMarsSite, selectedAnalog…
  lib/
    geo.js                     lat/lon ↔ Vector3 (matches SphereGeometry UVs), great-circle maths
    flightPath.js              camera "shots": orbit moves and the interplanetary spline
    tileTexture.js             NASA WMTS tile stitching (Mars Trek, GIBS) + fallbacks
  three/                       everything inside <Canvas>
  ui/                          HTML HUD (Tailwind)
```

**Camera choreography.** No component moves the camera. `CameraDirector` subscribes to store transitions
and runs *shots*. A shot is a pure function `evaluate(t, pose)`; GSAP tweens only `t`, and the director
applies the pose each frame after OrbitControls has updated. The Mars → Earth flight is a centripetal
Catmull-Rom spline through three segments, traversed by arc length:

1. a departure spiral around Mars, looking back at it (the "zoom out");
2. a bowed cruise between points on the facing sides of both planets, offset sideways so it can never
   cross a globe;
3. an arrival spiral around Earth that ends with a radial zoom onto the analog.

During the flight the orientation slerps from looking at Mars to looking at Earth.

## Shader gotcha: NaN means a black screen

The scene renders into an HDR (half-float) buffer, and the bloom blur spreads any single NaN pixel
across the whole frame. The result is a fully black canvas while the HTML HUD stays visible, and it
only shows up at some camera angles. On real GPUs (confirmed on AMD/Direct3D 11) these produce NaN:

- `pow(x, y)` with `x < 0`, even `-1e-9` from rounding, for example `pow(0.5 + 0.5*sin(t), 8.0)` or
  `pow(vUv.y, 1.4)`;
- `normalize(v)` with `v ≈ 0`, and `atan(0.0, 0.0)`.

In custom shaders, always clamp `pow` bases (`pow(clamp(x, 0.0, 1.0), y)`) and guard normalisations.
Software renderers (SwiftShader, headless CI) usually do **not** reproduce this, so test on a real GPU.

## Plugging in the real backend

Every component goes through one function:

```js
findBestAnalog(marsSite) → Promise<AnalogMatch>
```

The local scoring always runs (the Earth view needs the full ranking). Set `VITE_ANALOG_API_URL` (in
`.env.local`) and the service also sends a POST to `${VITE_ANALOG_API_URL}/match` with
`{ "mars_site": { id, name, lat, lon, kind, number } }`. A response `{ "analog": { "id": "G…S" } }` whose id
is an inventory glacier overrides the local pick. Any other answer, or an error, keeps the local result.

## Data & credits

- **Glacier-like forms:** Souness, C., Hubbard, B., Milliken, R. E., & Quincey, D. (2012). *An inventory and
  population-scale analysis of martian glacier-like forms.* Icarus 217(1), 243–255.
  doi:10.1016/j.icarus.2011.10.020. 1,309 GLFs mapped on CTX images.
  `glf_area_s` = length × width; `buffer_*` = MOLA elevation statistics (m).
- **SHARAD context:** radar evidence of buried water ice in lobate debris aprons comes from Holt et al. 2008
  (eastern Hellas) and Plaut et al. 2009 (Deuteronilus Mensae). The excess-ice layer in Arcadia Planitia is
  from Bramson et al. 2015.
- **Mars basemaps:** NASA Mars Trek (JPL/ASU), Viking MDIM 2.1 colour mosaic and MGS MOLA colour shaded relief.
- **Earth basemap:** NASA GIBS / EOSDIS, Blue Marble shaded relief + bathymetry. Clouds and specular maps come
  from the three.js examples.
- **Place names:** IAU/USGS Gazetteer of Planetary Nomenclature.
- **Andean analogs:** IANIGLA, Inventario Nacional de Glaciares — https://www.glaciaresargentinos.gob.ar.
  Glacier ids are ING ids; parameters and scores come from the team's coincidence pipeline (`data/source/`).
- **Pipeline inputs named in the data:** soil properties from ISRIC SoilGrids (CC BY 4.0), and ERA5-Land via
  Open-Meteo (CC BY 4.0). ERA5-Land contains modified Copernicus Climate Change Service information.
- **NASA Space Apps Challenge logo:** used for the challenge presentation only. No endorsement is implied.

Tiles stream from NASA at runtime. If they can't be reached, the globes fall back to a CDN texture and then
to a procedural one, so the app still runs offline.
