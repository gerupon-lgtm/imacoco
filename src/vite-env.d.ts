/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface Window {
  __IMAKOKO_UPDATE_SW__?: () => Promise<void>
}
