import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// No <StrictMode>: drei's <Html> creates its own React root and unmounts it synchronously in a
// layout-effect cleanup, which React 19 reports as an error on every StrictMode double-mount.
// Every <Html> in this app stays mounted for its scene's lifetime for the same reason.
createRoot(document.getElementById('root')).render(<App />)
