import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { CAMERA } from './config/scene'
import Experience from './three/Experience'
import { htmlPortal } from './three/SceneHtml'
import Hud from './ui/Hud'

// Append ?capture to the URL when screen-recording / screenshotting the demo: keeps the WebGL
// drawing buffer so capture tools never grab an empty frame (small GPU cost, so off by default).
const CAPTURE_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('capture')

export default function App() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ fov: CAMERA.fov, near: CAMERA.near, far: CAMERA.far, position: CAMERA.introFrom }}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: CAPTURE_MODE }}
      >
        <Suspense fallback={null}>
          <Experience />
        </Suspense>
      </Canvas>
      {/* In-scene HTML labels render here (see three/SceneHtml.jsx); isolated so the HUD stays on top. */}
      <div
        ref={(el) => {
          htmlPortal.current = el
        }}
        className="pointer-events-none absolute inset-0 isolate overflow-hidden"
      />
      <Hud />
    </div>
  )
}
