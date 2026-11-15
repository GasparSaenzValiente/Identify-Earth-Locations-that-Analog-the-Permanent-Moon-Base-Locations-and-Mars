import { forwardRef, useMemo } from 'react'
import { Sphere, Vector3 } from 'three'

const _sphere = new Sphere()
const _center = new Vector3()
const _hit = new Vector3()

/**
 * Analytic ray–sphere raycast: the globe is hit-tested in O(1) instead of against ~50k triangles
 * on every pointer move. It still occludes markers on the far side because it receives events.
 */
export function makeSphereRaycast(radius) {
  return function sphereRaycast(raycaster, intersects) {
    this.getWorldPosition(_center)
    const scale = this.matrixWorld.getMaxScaleOnAxis()
    _sphere.set(_center, radius * scale)
    if (!raycaster.ray.intersectSphere(_sphere, _hit)) return
    const distance = raycaster.ray.origin.distanceTo(_hit)
    if (distance < raycaster.near || distance > raycaster.far) return
    intersects.push({ distance, point: _hit.clone(), object: this })
  }
}

const stop = (e) => e.stopPropagation()

/**
 * A textured planet sphere. It swallows pointer events so markers behind the planet never react.
 */
export const Globe = forwardRef(function Globe({ radius, segments = 192, children, ...meshProps }, ref) {
  const raycast = useMemo(() => makeSphereRaycast(radius), [radius])
  return (
    <mesh ref={ref} raycast={raycast} onPointerMove={stop} onPointerOver={stop} onClick={stop} {...meshProps}>
      <sphereGeometry args={[radius, segments, segments / 2]} />
      {children}
    </mesh>
  )
})
