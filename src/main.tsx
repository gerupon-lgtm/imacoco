import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import { App } from './App'
import './index.css'

const previewMode = import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview')

const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new Event('imakoko:pwa-update'))
  },
  onOfflineReady() {
    window.dispatchEvent(new Event('imakoko:pwa-offline-ready'))
  }
})
window.__IMAKOKO_UPDATE_SW__ = () => updateSW(true)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App initialMode={previewMode ? 'preview' : undefined} />
  </StrictMode>
)
