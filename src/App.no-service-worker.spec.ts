import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

import App from './App.vue'
import { routes } from './router'

describe('App without Service Worker support', () => {
  it('still mounts and renders the shell when the Service Worker API is absent', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
    // Simulate a browser that does not implement the Service Worker API.
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
    })

    try {
      const router = createRouter({ history: createMemoryHistory(), routes })
      router.push('/')
      await router.isReady()

      const wrapper = mount(App, { global: { plugins: [router] } })

      expect(wrapper.find('.peecare-app').exists()).toBe(true)
      expect(wrapper.text()).toContain('PeeCare')
      expect(wrapper.text()).toContain('尚無裝置資料')
    } finally {
      if (original) {
        Object.defineProperty(navigator, 'serviceWorker', original)
      } else {
        // @ts-expect-error - allow cleanup when the property was absent.
        delete navigator.serviceWorker
      }
    }
  })
})
