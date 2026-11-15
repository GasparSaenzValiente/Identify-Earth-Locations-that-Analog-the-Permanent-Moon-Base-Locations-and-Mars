import { CanvasTexture, SRGBColorSpace } from 'three'

/**
 * Offline fallback globes. They are only shown for the first moments before the NASA tiles
 * arrive, or permanently if the network is unavailable. Tileable in longitude.
 */

function hash(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function valueNoise(x, y, periodX, seed) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const xa = ((x0 % periodX) + periodX) % periodX
  const xb = (xa + 1) % periodX
  const a = hash(xa, y0, seed)
  const b = hash(xb, y0, seed)
  const c = hash(xa, y0 + 1, seed)
  const d = hash(xb, y0 + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

function fbm(u, v, seed) {
  let amp = 0.5
  let freq = 6
  let sum = 0
  for (let o = 0; o < 5; o++) {
    sum += amp * valueNoise(u * freq, v * freq * 0.5, freq, seed + o * 17)
    amp *= 0.5
    freq *= 2
  }
  return sum
}

const mix = (a, b, t) => a + (b - a) * t

const PALETTES = {
  mars: (n, lat) => {
    const dark = [92, 42, 24]
    const mid = [178, 86, 44]
    const light = [222, 142, 88]
    const t = Math.min(1, Math.max(0, (n - 0.28) * 2.1))
    let rgb = t < 0.5 ? dark.map((c, i) => mix(c, mid[i], t * 2)) : mid.map((c, i) => mix(c, light[i], (t - 0.5) * 2))
    const cap = Math.min(1, Math.max(0, (Math.abs(lat) - 76) / 6))
    rgb = rgb.map((c) => mix(c, 238, cap))
    return rgb
  },
  earth: (n, lat) => {
    const land = n > 0.53
    let rgb = land
      ? [mix(64, 140, (n - 0.53) * 3), mix(92, 120, (n - 0.53) * 3), mix(48, 80, (n - 0.53) * 3)]
      : [mix(6, 16, n), mix(28, 60, n), mix(64, 110, n)]
    const cap = Math.min(1, Math.max(0, (Math.abs(lat) - 70) / 8))
    rgb = rgb.map((c) => mix(c, 235, cap))
    return rgb
  },
}

const cache = new Map()

export function getProceduralTexture(kind = 'mars', width = 512) {
  if (cache.has(kind)) return cache.get(kind)
  const height = width / 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(width, height)
  const palette = PALETTES[kind] ?? PALETTES.mars
  const seed = kind === 'mars' ? 7 : 3
  for (let y = 0; y < height; y++) {
    const v = y / height
    const lat = 90 - v * 180
    for (let x = 0; x < width; x++) {
      const n = fbm(x / width, v, seed)
      const [r, g, b] = palette(n, lat)
      const i = (y * width + x) * 4
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = b
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.userData.procedural = true
  cache.set(kind, texture)
  return texture
}
