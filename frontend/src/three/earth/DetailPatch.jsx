import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CanvasTexture, MathUtils, SphereGeometry } from 'three'
import { LIGHTING } from '../../config/scene'
import { BASEMAPS, canvasToTexture, stitchRegion } from '../../lib/tileTexture'

/** Soft edge mask so the high-resolution patch melts into the global texture (one shared texture). */
let edgeMask = null
function getEdgeMask() {
  edgeMask ??= (() => {
    const size = 256
    const c = document.createElement('canvas')
    c.width = c.height = size
    const ctx = c.getContext('2d')
    const img = ctx.createImageData(size, size)
    const edge = (x) => MathUtils.smoothstep(x, 0, 0.14)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / (size - 1)
        const v = y / (size - 1)
        const a = edge(u) * edge(1 - u) * edge(v) * edge(1 - v)
        const i = (y * size + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255)
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return new CanvasTexture(c)
  })()
  return edgeMask
}

/**
 * NASA GIBS tiles at ~500 m/px (level 7) stitched around the analog and draped on a partial sphere
 * just above Earth's surface. Loading starts as soon as the analog is known — i.e. during the
 * flight — so the close-up is sharp on arrival.
 */
export default function DetailPatch({ lat, lon, radius }) {
  const gl = useThree((s) => s.gl)
  const material = useRef()
  const [patch, setPatch] = useState(null)
  const alphaMap = getEdgeMask()

  useEffect(() => {
    let alive = true
    let created = null
    const spec = BASEMAPS.earthBlueMarble
    stitchRegion(spec, spec.detailLevel, lat, lon, { across: 6, down: 4 })
      .then(({ canvas, bounds }) => {
        if (!alive) return
        const texture = canvasToTexture(canvas, Math.min(8, gl.capabilities.getMaxAnisotropy()))
        const D2R = MathUtils.DEG2RAD
        const geometry = new SphereGeometry(
          radius * 1.0007,
          96,
          64,
          (bounds.lonMin + 180) * D2R,
          (bounds.lonMax - bounds.lonMin) * D2R,
          (90 - bounds.latMax) * D2R,
          (bounds.latMax - bounds.latMin) * D2R,
        )
        created = { texture, geometry }
        setPatch(created)
      })
      .catch((err) => console.warn('[detail patch] unavailable:', err.message))
    return () => {
      alive = false
      if (created) {
        created.texture.dispose()
        created.geometry.dispose()
      }
    }
  }, [lat, lon, radius, gl])

  useFrame((_, dt) => {
    if (material.current) material.current.opacity = MathUtils.damp(material.current.opacity, 1, 1.8, dt)
  })

  if (!patch) return null
  return (
    <mesh geometry={patch.geometry} renderOrder={1} raycast={() => null}>
      <meshPhongMaterial
        ref={material}
        map={patch.texture}
        emissive="#ffffff"
        emissiveMap={patch.texture}
        emissiveIntensity={LIGHTING.earthFill}
        alphaMap={alphaMap}
        transparent
        opacity={0}
        depthWrite={false}
        shininess={4}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  )
}
