import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  TextureLoader,
} from 'three'

/**
 * Real NASA basemaps, stitched client-side from public WMTS tile services (both send
 * `Access-Control-Allow-Origin: *`, so the canvases stay untainted and can be uploaded to WebGL).
 *
 *  - NASA Mars Trek (JPL/ASU): equirectangular "default028mm" matrix set,
 *    level z has 2^(z+1) × 2^z tiles of 256 px, each 180/2^z degrees, URL …/{z}/{row}/{col}.jpg
 *  - NASA GIBS (EOSDIS), EPSG:4326 "500m" matrix set: 512 px tiles, each 288/2^z degrees,
 *    so the last column/row is partially empty; URL …/{z}/{row}/{col}.jpeg, max level 7.
 *
 * Each spec also names a single-image fallback (three.js / threex example textures on jsDelivr).
 */
export const BASEMAPS = {
  marsViking: {
    key: 'marsViking',
    planet: 'mars',
    label: 'NASA Mars Trek · Viking MDIM 2.1 colour mosaic',
    short: 'Viking colour',
    tileUrl: (z, row, col) =>
      `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${z}/${row}/${col}.jpg`,
    tileDeg: (z) => 180 / 2 ** z,
    levels: [2, 3],
    fill: '#8a4a2c',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/marsmap1k.jpg',
    fallbackLabel: 'threex.planets Mars map (fallback)',
    procedural: 'mars',
  },
  marsMola: {
    key: 'marsMola',
    planet: 'mars',
    label: 'NASA Mars Trek · MGS MOLA colourised shaded relief',
    short: 'MOLA relief',
    tileUrl: (z, row, col) =>
      `https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/${z}/${row}/${col}.jpg`,
    tileDeg: (z) => 180 / 2 ** z,
    levels: [2, 3],
    fill: '#3a5a8a',
    fallbackUrl: null,
    procedural: 'mars',
  },
  earthBlueMarble: {
    key: 'earthBlueMarble',
    planet: 'earth',
    label: 'NASA GIBS · Blue Marble shaded relief + bathymetry',
    short: 'Blue Marble',
    tileUrl: (z, row, col) =>
      `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/500m/${z}/${row}/${col}.jpeg`,
    tileDeg: (z) => 288 / 2 ** z,
    // L2 = 2560×1280 (~15 km/px) first, then L3 = 5120×2560 (~7.8 km/px) where the GPU allows it.
    levels: [2, 3],
    detailLevel: 7,
    fill: '#0b2340',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/planets/earth_atmos_2048.jpg',
    fallbackLabel: 'three.js Earth texture (fallback)',
    procedural: 'earth',
  },
}

export const EARTH_EXTRAS = {
  clouds: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/planets/earth_clouds_1024.png',
  specular: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/planets/earth_specular_2048.jpg',
}

async function loadTile(url) {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  return createImageBitmap(blob)
}

/** Run `worker` over `items` with at most `limit` in flight. Never rejects; failures → null. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function lane() {
    while (next < items.length) {
      const i = next++
      try {
        results[i] = await worker(items[i], i)
      } catch {
        results[i] = null
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return results
}

/**
 * Paint loaded tiles into one canvas. `fill: null` leaves missing tiles transparent (used for the
 * Earth detail patch, so the global texture shows through gaps). Returns how many tiles failed.
 */
function drawTiles({ tiles, results, widthDeg, heightDeg, deg, fill, maxFailRatio = 0.25 }) {
  const sample = results.find(Boolean)
  if (!sample) throw new Error('no tiles could be loaded')
  const failed = results.filter((r) => !r).length
  if (failed / results.length > maxFailRatio) throw new Error(`${failed}/${results.length} tiles failed`)

  const px = sample.width
  const width = Math.round((widthDeg / deg) * px)
  const height = Math.round((heightDeg / deg) * px)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (fill) {
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, width, height)
  }
  tiles.forEach((t, i) => {
    const img = results[i]
    if (!img) return
    ctx.drawImage(img, (t.c - t.c0) * px, (t.r - t.r0) * px, px, px)
    img.close?.()
  })
  return { canvas, failed }
}

/** Stitch a whole-globe equirectangular canvas for `spec` at tile level `z` → { canvas, failed }. */
export async function stitchGlobal(spec, z, { maxTextureSize = 8192, concurrency = 8 } = {}) {
  const deg = spec.tileDeg(z)
  const cols = Math.ceil(360 / deg - 1e-9)
  const rows = Math.ceil(180 / deg - 1e-9)
  const estimateWidth = Math.round((360 / deg) * (spec.key.startsWith('earth') ? 512 : 256))
  if (estimateWidth > maxTextureSize) throw new Error(`level ${z} exceeds max texture size ${maxTextureSize}`)

  const tiles = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push({ r, c, r0: 0, c0: 0 })
  const results = await mapLimit(tiles, concurrency, (t) => loadTile(spec.tileUrl(z, t.r, t.c)))
  return drawTiles({ tiles, results, widthDeg: 360, heightDeg: 180, deg, fill: spec.fill })
}

/**
 * Stitch a high-resolution regional patch around (lat, lon): `across` × `down` tiles at level z.
 * Returns the canvas plus its geographic bounds (degrees) so it can be draped on a partial sphere.
 */
export async function stitchRegion(spec, z, lat, lon, { across = 6, down = 4, concurrency = 8 } = {}) {
  const deg = spec.tileDeg(z)
  const totalCols = Math.ceil(360 / deg - 1e-9)
  const totalRows = Math.ceil(180 / deg - 1e-9)

  const fx = (lon + 180) / deg
  const fy = (90 - lat) / deg
  const c0 = Math.floor(fx) - Math.floor((across - 1) / 2) - (fx - Math.floor(fx) < 0.5 && across % 2 === 0 ? 1 : 0)
  let r0 = Math.floor(fy) - Math.floor((down - 1) / 2) - (fy - Math.floor(fy) < 0.5 && down % 2 === 0 ? 1 : 0)
  r0 = Math.max(0, Math.min(totalRows - down, r0))

  const tiles = []
  for (let r = r0; r < r0 + down; r++) {
    for (let c = c0; c < c0 + across; c++) tiles.push({ r, c, r0, c0 })
  }
  const results = await mapLimit(tiles, concurrency, (t) =>
    loadTile(spec.tileUrl(z, t.r, ((t.c % totalCols) + totalCols) % totalCols)),
  )
  const { canvas } = drawTiles({
    tiles,
    results,
    widthDeg: across * deg,
    heightDeg: down * deg,
    deg,
    fill: null, // gaps stay transparent so the global basemap shows through
    maxFailRatio: 0.34,
  })
  return {
    canvas,
    bounds: {
      lonMin: -180 + c0 * deg,
      lonMax: -180 + (c0 + across) * deg,
      latMax: 90 - r0 * deg,
      latMin: 90 - (r0 + down) * deg,
    },
  }
}

export function canvasToTexture(canvas, anisotropy = 8) {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = anisotropy
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

const loader = new TextureLoader()
loader.setCrossOrigin('anonymous')

export async function loadTextureUrl(url, { anisotropy = 8, colorSpace = SRGBColorSpace } = {}) {
  const texture = await loader.loadAsync(url)
  texture.colorSpace = colorSpace
  texture.anisotropy = anisotropy
  return texture
}
