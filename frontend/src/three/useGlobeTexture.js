import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { getProceduralTexture } from '../lib/proceduralTexture'
import { canvasToTexture, loadTextureUrl, stitchGlobal } from '../lib/tileTexture'

/**
 * Progressive globe texture: procedural placeholder → NASA tiles (each configured level, low to
 * high) → single-image CDN fallback if the tile service is unreachable.
 *
 * Loads are shared and cached per basemap key, so toggling basemaps (or React StrictMode's double
 * mount) never refetches. Superseded levels are disposed once the material has switched.
 */
const loaders = new Map()

function publish(entry, texture, source) {
  const previous = entry.best?.texture
  entry.best = { texture, source }
  entry.listeners.forEach((fn) => fn(entry.best))
  if (previous && previous !== texture && !previous.userData.procedural) {
    setTimeout(() => previous.dispose(), 1500)
  }
}

async function run(spec, gl, entry) {
  const maxTextureSize = gl.capabilities.maxTextureSize
  const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
  let loadedAny = false
  let partial = null // a first level with a few missing tiles, kept in reserve
  for (const level of spec.levels) {
    try {
      const { canvas, failed } = await stitchGlobal(spec, level, { maxTextureSize })
      if (failed > 0) {
        // Never downgrade a complete level with a patchy one; for the first level prefer the
        // complete single-image fallback and only use the patchy stitch if that fails too.
        if (!loadedAny) partial = { canvas, level, failed }
        console.warn(`[basemap] ${spec.key} level ${level}: ${failed} tiles missing`)
        break
      }
      publish(entry, canvasToTexture(canvas, anisotropy), `${spec.label} · L${level}`)
      loadedAny = true
    } catch (err) {
      console.warn(`[basemap] ${spec.key} level ${level} unavailable:`, err.message)
      break
    }
  }
  if (loadedAny) return
  if (spec.fallbackUrl) {
    try {
      publish(entry, await loadTextureUrl(spec.fallbackUrl, { anisotropy }), spec.fallbackLabel)
      return
    } catch (err) {
      console.warn(`[basemap] ${spec.key} fallback unavailable:`, err.message)
    }
  }
  if (partial) {
    publish(entry, canvasToTexture(partial.canvas, anisotropy), `${spec.label} · L${partial.level} (${partial.failed} tiles missing)`)
  }
}

function subscribe(spec, gl, listener) {
  let entry = loaders.get(spec.key)
  if (!entry) {
    entry = { listeners: new Set(), best: null }
    loaders.set(spec.key, entry)
    run(spec, gl, entry)
  }
  entry.listeners.add(listener)
  if (entry.best) listener(entry.best)
  return () => entry.listeners.delete(listener)
}

export function useGlobeTexture(spec) {
  const gl = useThree((s) => s.gl)
  const [state, setState] = useState(() => {
    const cached = loaders.get(spec.key)?.best
    return cached ?? { texture: getProceduralTexture(spec.procedural), source: 'procedural placeholder' }
  })

  useEffect(() => {
    const cached = loaders.get(spec.key)?.best
    setState(cached ?? { texture: getProceduralTexture(spec.procedural), source: 'procedural placeholder' })
    return subscribe(spec, gl, setState)
  }, [spec, gl])

  return state
}

/** One-off optional texture (clouds, specular…): null until loaded, null forever on failure. */
const optionalCache = new Map()
export function useOptionalTexture(url, options) {
  const [texture, setTexture] = useState(() => optionalCache.get(url)?.texture ?? null)
  useEffect(() => {
    let alive = true
    let entry = optionalCache.get(url)
    if (!entry) {
      entry = { texture: null, promise: loadTextureUrl(url, options).catch(() => null) }
      optionalCache.set(url, entry)
    }
    entry.promise.then((t) => {
      entry.texture = t
      if (alive) setTexture(t)
    })
    return () => {
      alive = false
    }
    // options are static per call-site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])
  return texture
}
