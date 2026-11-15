import { useId, useLayoutEffect, useRef, useState } from 'react'

const TONES = {
  ice: { stroke: '#19e3ff', glow: 'rgb(25 227 255 / 0.55)' },
  amber: { stroke: '#ffb347', glow: 'rgb(255 179 71 / 0.55)' },
  alert: { stroke: '#ff4d5e', glow: 'rgb(255 77 94 / 0.6)' },
}

/**
 * Sci-fi HUD frame: chamfered top-left / bottom-right corners, an outline that draws itself in,
 * accent bars and tick marks. The outline is an SVG sized from the element (ResizeObserver), so
 * chamfers stay a fixed size whatever the content.
 */
export default function HudPanel({
  children,
  tone = 'ice',
  cut = 16,
  delay = 0,
  decor = true,
  className = '',
  contentClassName = '',
  as: Tag = 'div',
  style,
  ref: externalRef, // React 19: ref is a plain prop; merged with the internal measuring ref
  ...rest
}) {
  const ref = useRef(null)
  const setRef = (el) => {
    ref.current = el
    if (typeof externalRef === 'function') externalRef(el)
    else if (externalRef) externalRef.current = el
  }
  const [size, setSize] = useState({ w: 0, h: 0 })
  const gradId = `hudg${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const update = () => setSize((s) => (s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { w, h } = size
  const c = Math.max(4, Math.min(cut, w / 5, h / 3))
  const t = TONES[tone] ?? TONES.ice
  const outline = `M${c},0.75 H${w - 0.75} V${h - c} L${w - c},${h - 0.75} H0.75 V${c} Z`
  const len = Math.ceil(2 * (w - c) + 2 * (h - c) + 2 * c * Math.SQRT2)
  const clip = `polygon(${c}px 0, 100% 0, 100% calc(100% - ${c}px), calc(100% - ${c}px) 100%, 0 100%, 0 ${c}px)`
  const accentTop = Math.min(110, w * 0.3)
  const accentBottom = Math.min(70, w * 0.22)

  return (
    <Tag
      ref={setRef}
      className={`hud-panel hud-panel--${tone} ${className}`}
      style={{ '--hud-delay': `${delay}ms`, ...style }}
      {...rest}
    >
      <div className="hud-panel__bg" style={{ clipPath: clip }} />
      {w > 0 && (
        <svg className="hud-panel__frame" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ filter: `drop-shadow(0 0 5px ${t.glow})` }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={t.stroke} stopOpacity="1" />
              <stop offset="0.45" stopColor={t.stroke} stopOpacity="0.35" />
              <stop offset="1" stopColor={t.stroke} stopOpacity="0.85" />
            </linearGradient>
          </defs>
          <path d={outline} className="hud-panel__stroke" stroke={`url(#${gradId})`} style={{ '--len': len }} />
          {decor && (
            <>
              <path d={`M${c + 10},1.5 H${c + 10 + accentTop}`} className="hud-panel__accent" stroke={t.stroke} />
              <path d={`M${w - c - 8},${h - 1.5} H${w - c - 8 - accentBottom}`} className="hud-panel__accent" stroke={t.stroke} />
              {[0, 1, 2].map((i) => (
                <path key={i} d={`M${w - 12 - i * 7},5 l-4,6`} className="hud-panel__tick" stroke={t.stroke} />
              ))}
              <path d={`M1.5,${h - 12} V${h - 30}`} className="hud-panel__accent" stroke={t.stroke} />
            </>
          )}
        </svg>
      )}
      <div className={`hud-panel__content ${contentClassName}`}>{children}</div>
    </Tag>
  )
}
