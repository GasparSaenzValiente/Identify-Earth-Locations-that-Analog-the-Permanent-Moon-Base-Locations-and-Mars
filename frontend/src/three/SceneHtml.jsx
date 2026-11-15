import { Html } from '@react-three/drei'

/**
 * Stable DOM container for every in-scene HTML label.
 *
 * drei's <Html> appends to `portal.current || events.connected || canvas.parentNode` and re-creates
 * its React root whenever that target changes. `events.connected` is only set a moment after the
 * first render, so without a fixed portal every label unmounts/remounts once at startup (React 19
 * logs "Attempted to synchronously unmount a root…"). App.jsx assigns this ref to an overlay div
 * that sits exactly over the canvas.
 */
export const htmlPortal = { current: null }

export default function SceneHtml(props) {
  return <Html portal={htmlPortal} {...props} />
}
