import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

import App from './App.vue'
import { routes } from './router'

async function mountApp() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push('/')
  await router.isReady()
  return mount(App, { global: { plugins: [router] } })
}

describe('App', () => {
  it('mounts the root application shell', async () => {
    const wrapper = await mountApp()

    expect(wrapper.exists()).toBe(true)
    expect(wrapper.find('.peecare-app').exists()).toBe(true)
  })
})
