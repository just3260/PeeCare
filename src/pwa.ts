import { registerSW } from 'virtual:pwa-register'

// Registers the generated service worker. Imported lazily from main.ts and
// only in production builds, so development and unit-test modes never load
// this module or register a service worker.
export function registerServiceWorker(): void {
  registerSW({ immediate: true })
}
