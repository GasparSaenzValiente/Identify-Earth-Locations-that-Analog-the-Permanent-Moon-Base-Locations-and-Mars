import { useEffect, useRef, useState } from 'react'

const REDUCED =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Animated number (ease-out) whenever `value` changes. */
export function useCountUp(value, duration = 1100) {
  const [shown, setShown] = useState(REDUCED ? value : 0)
  const from = useRef(0)
  useEffect(() => {
    if (REDUCED) {
      setShown(value)
      return undefined
    }
    const start = performance.now()
    const a = from.current
    let id
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const e = 1 - (1 - t) ** 3
      const v = a + (value - a) * e
      setShown(v)
      if (t < 1) id = requestAnimationFrame(tick)
      else from.current = value
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [value, duration])
  return shown
}

export function CountUp({ value, duration, format = (v) => Math.round(v).toLocaleString('en-US') }) {
  return <>{format(useCountUp(value, duration))}</>
}

/** Text that types itself out once (optionally after a delay). */
export function Typewriter({ text, speed = 22, delay = 0, className = '' }) {
  const [n, setN] = useState(REDUCED ? text.length : 0)
  useEffect(() => {
    if (REDUCED) {
      setN(text.length)
      return undefined
    }
    setN(0)
    let i = 0
    let id
    const start = setTimeout(function step() {
      i += 1
      setN(i)
      if (i < text.length) id = setTimeout(step, speed)
    }, delay)
    return () => {
      clearTimeout(start)
      clearTimeout(id)
    }
  }, [text, speed, delay])
  return (
    <span className={className}>
      {text.slice(0, n)}
      {n < text.length && <span className="hud-blink">▌</span>}
    </span>
  )
}

/** Segmented bar (value 0..1) in the style of a HUD buffer meter. */
export function SegmentBar({ value, segments = 16, tone = 'ice', className = '', stagger = 18 }) {
  const on = Math.round(Math.max(0, Math.min(1, value)) * segments)
  return (
    <div className={`hud-bar ${tone === 'amber' ? 'hud-bar--amber' : ''} ${className}`} aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} data-on={i < on} style={i < on ? { animationDelay: `${i * stagger}ms` } : undefined} />
      ))}
    </div>
  )
}

/** Keeps a component mounted for an exit animation after `show` turns false. */
export function usePresence(show, exitMs = 450) {
  const [mounted, setMounted] = useState(show)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (show) {
      setMounted(true)
      setLeaving(false)
      return undefined
    }
    if (!mounted) return undefined
    setLeaving(true)
    const id = setTimeout(() => {
      setMounted(false)
      setLeaving(false)
    }, exitMs)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])
  return { mounted, leaving }
}

/** Corner bracket decoration (for headers / framed values). */
export function Brackets({ className = '', tone = '#19e3ff' }) {
  return (
    <svg className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
      {[
        'M0,22 V0 H22',
        'M78,0 H100 V22',
        'M100,78 V100 H78',
        'M22,100 H0 V78',
      ].map((d) => (
        <path key={d} d={d} fill="none" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}
