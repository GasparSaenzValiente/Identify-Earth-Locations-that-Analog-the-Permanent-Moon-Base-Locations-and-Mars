import { Vector3 } from 'three'

/**
 * Per-frame mutable state shared between 3D components and the HUD. Deliberately NOT in React or
 * Zustand state: these values change every frame and would otherwise trigger re-renders.
 */

/** Written by <CameraDirector/>. */
export const flightState = {
  active: false,
  direction: 'toEarth', // 'toEarth' | 'toMars'
  progress: 0,
  warp: 0, // 0..1, derived from camera speed
  focusCenter: new Vector3(), // planet the sun light is aimed at
}

/** Written by <ScanSweep/> (GSAP), read by markers + shader. */
export const scanState = {
  progress: 0, // radians swept, 0 → SCAN_END
  offset: 0, // azimuth where the sweep started (SHARAD ground track)
  active: 0, // shader intensity 0..1
}

/** Written by <ViewTelemetry/> (Experience) — the camera's sub-point on the planet in focus. */
export const viewState = {
  planet: 'mars',
  lat: 0,
  lon: 0,
  altitudeKm: 0,
}

/** Written by <SharadSatellite/>. */
export const sharadState = {
  phi: 0, // azimuth of the sub-satellite point, [0, 2π)
  position: new Vector3(),
}
