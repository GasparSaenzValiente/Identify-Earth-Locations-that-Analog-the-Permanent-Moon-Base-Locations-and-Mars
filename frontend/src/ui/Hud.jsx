import { useEffect, useState } from 'react'
import { useMissionStore } from '../store/useMissionStore'
import AnalogPanel from './AnalogPanel'
import EarthPanel from './EarthPanel'
import HudChrome from './HudChrome'
import HudPanel from './hud/HudPanel'
import MarsPanel from './MarsPanel'
import { PhaseHint } from './PhaseHint'
import { AnalysisPopout, ArrivalPopout, ConfirmPopout, ScanCompletePopout } from './Popouts'
import TopBar from './TopBar'
import TransitOverlay from './TransitOverlay'

/** Presentation attribution from a texture-loader label (levels, placeholders, fallbacks → console only). */
function attribution(source) {
  if (!source || source.startsWith('procedural')) return null
  if (/fallback/i.test(source)) return null
  return source.replace(/ · L\d+.*$/, '').replace(/ \(\d+ tiles missing\)$/, '')
}

function Credits() {
  const sources = useMissionStore((s) => s.textureSources)
  const phase = useMissionStore((s) => s.phase)
  const planet = useMissionStore((s) => s.activePlanet)
  const mars = attribution(sources.mars)
  const earth = attribution(sources.earth)
  // Hidden while a dialog occupies the bottom band (it would sit over the Launch button).
  const busy = phase === 'matching' || phase === 'confirm'
  return (
    <>
      <footer
        className={`pointer-events-none absolute bottom-4 right-6 hidden w-[min(360px,calc(50vw-360px))] text-right font-mono text-[9.5px] leading-relaxed text-white/60 transition-opacity duration-300 xl:block ${busy ? 'opacity-0' : ''}`}
      >
        <div>GLFs · Souness et al. (2012), Icarus 217 · Names · IAU/USGS Gazetteer</div>
        {planet === 'mars' && mars && <div className="truncate">MARS · {mars}</div>}
        {planet === 'earth' && <div className="truncate">ANDES · ING (IANIGLA) · SoilGrids (ISRIC) · ERA5-Land (Copernicus)</div>}
        {planet === 'earth' && earth && <div className="truncate">EARTH · {earth}</div>}
      </footer>
      {phase !== 'earth' && (
        <footer className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-white/55 xl:hidden">
          NASA Mars Trek · NASA GIBS · Souness et al. 2012 · IAU/USGS · IANIGLA
        </footer>
      )}
    </>
  )
}

function Toast() {
  const matchError = useMissionStore((s) => s.matchError)
  const glfError = useMissionStore((s) => s.glf.error)
  const andesError = useMissionStore((s) => s.andes.error)
  const dismiss = useMissionStore((s) => s.dismissError)
  const message = matchError ?? glfError ?? andesError
  if (!message) return null
  return (
    // From md the Mars panel (330px) is open on the left: centre the alert in the remaining column.
    <div role="alert" className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center px-4 sm:bottom-28 md:left-[calc(330px+2rem)]">
      <HudPanel tone="alert" cut={12} className="pointer-events-auto w-full max-w-[520px]" contentClassName="flex items-center gap-4 px-4 py-3">
        <span className="font-display text-[11px] font-bold tracking-[0.2em] text-alert hud-blink">ALERT</span>
        <span className="text-[14px] text-white">{message}</span>
        <button type="button" className="hud-btn hud-btn--danger !px-3 !py-1 !text-[10px]" onClick={dismiss}>
          Dismiss
        </button>
      </HudPanel>
    </div>
  )
}

/** Screen-reader announcements for each step of the mission. */
function LiveStatus() {
  const phase = useMissionStore((s) => s.phase)
  const count = useMissionStore((s) => s.glf.items.length)
  const site = useMissionStore((s) => s.selectedMarsSite)
  const match = useMissionStore((s) => s.selectedAnalog)
  const messages = {
    intro: 'Mars view. Activate the SHARAD orbiter to run a radar sweep.',
    scanning: 'Radar sweep in progress. Loading glacier-like forms.',
    mars: `${count} glacier-like forms on Mars. Select one to find its Andean analog.`,
    matching: site ? `Searching the Andean analog for ${site.name}.` : '',
    confirm: match ? `Analog found: ${match.analog.name}, ${match.score.toFixed(1)} percent match. Launch to Earth or abort.` : '',
    transit: match ? `Flying to Earth. Destination ${match.analog.name}.` : 'Flying to Earth.',
    earth: match ? `Comparing ${match.analog.name}, glacier ${match.analog.code}, ${match.analog.sector.province}: ${match.score.toFixed(1)} percent match.` : '',
    returning: 'Returning to Mars.',
  }
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {messages[phase] ?? ''}
    </div>
  )
}

function IntroFade() {
  const [gone, setGone] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGone(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 bg-black transition-opacity duration-[2200ms] ease-out ${gone ? 'opacity-0' : 'opacity-100'}`}
    />
  )
}

export default function Hud() {
  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans text-[#dff8ff]">
      <IntroFade />
      <HudChrome />
      <TopBar />
      <MarsPanel />
      <EarthPanel />
      <AnalogPanel />
      <ScanCompletePopout />
      <AnalysisPopout />
      <ConfirmPopout />
      <TransitOverlay />
      <ArrivalPopout />
      <PhaseHint />
      <Credits />
      <Toast />
      <LiveStatus />
    </div>
  )
}
