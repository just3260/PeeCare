import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import './styles/main.css'

const app = createApp(App)
app.use(router)
app.mount('#app')

// The service worker is registered only in production builds. Development and
// unit-test modes never register it, and browsers without Service Worker
// support still mount the Vue application above.
if (import.meta.env.PROD) {
  void import('./pwa').then((module) => module.registerServiceWorker())
}
