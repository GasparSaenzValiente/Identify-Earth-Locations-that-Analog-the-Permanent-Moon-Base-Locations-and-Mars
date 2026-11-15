import { Color } from 'three'
import { clamp01 } from '../../lib/math'

/** Colour scales of the Earth layers (shared by the 3D markers and the HUD legends). */
const ramp = (stops) => {
  const cols = stops.map(([t, hex]) => [t, new Color(hex)])
  return (t, out) => {
    const x = clamp01(t)
    for (let i = 1; i < cols.length; i++) {
      if (x <= cols[i][0]) {
        const [t0, c0] = cols[i - 1]
        const [t1, c1] = cols[i]
        return out.copy(c0).lerp(c1, (x - t0) / (t1 - t0))
      }
    }
    return out.copy(cols[cols.length - 1][1])
  }
}

const MATCH_STOPS = [
  [0, '#3346ff'],
  [0.35, '#19e3ff'],
  [0.6, '#4dffc3'],
  [0.82, '#ffb347'],
  [1, '#ffe2b0'],
]
const SURVEY_STOPS = [
  [0, '#1d5f7a'],
  [0.6, '#3fc2b4'],
  [1, '#b8fff0'],
]
const css = (stops) => `linear-gradient(90deg, ${stops.map(([t, c]) => `${c} ${Math.round(t * 100)}%`).join(', ')})`

export const EARTH_SCALES = {
  match: { min: 30, max: 90, label: 'Relative match (P5–P95)', minLabel: '≤30%', maxLabel: '≥90%', gradient: css(MATCH_STOPS), f: ramp(MATCH_STOPS) },
  absolute: { min: 15, max: 47, label: 'Absolute score · pipeline', minLabel: '≤15%', maxLabel: '≥47%', gradient: css(MATCH_STOPS), f: ramp(MATCH_STOPS) },
  survey: { min: 70, max: 100, label: 'Survey grid · soil thermal score', minLabel: '≤70%', maxLabel: '100%', gradient: css(SURVEY_STOPS), f: ramp(SURVEY_STOPS) },
}

const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

/** HDR marker colour: a fixed luminance so every marker blooms the same amount. */
export function scaleColor(scaleKey, value, luminance, out = new Color()) {
  const s = EARTH_SCALES[scaleKey]
  s.f((value - s.min) / (s.max - s.min), out)
  return out.multiplyScalar(luminance / Math.max(lum(out), 1e-3))
}
