import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

import App from './App.vue'
import { routes } from './router'

async function mountApp(path = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push(path)
  await router.isReady()
  return { router, wrapper: mount(App, { global: { plugins: [router] } }) }
}

describe('App', () => {
  it('mounts the root application shell', async () => {
    const { wrapper } = await mountApp()

    expect(wrapper.exists()).toBe(true)
    expect(wrapper.find('.peecare-app').exists()).toBe(true)
  })

  it.each([
    ['/history', '歷史'],
    ['/stats', '統計'],
    ['/settings', '設定'],
    ['/notifications', '通知'],
  ])('keeps bottom navigation visible on %s', async (path, activeLabel) => {
    const { wrapper } = await mountApp(path)

    expect(wrapper.find('nav[aria-label="主要導覽"]').exists()).toBe(true)
    expect(wrapper.get('.bottom-nav__item--active').text()).toBe(activeLabel)
  })

  it('does not show bottom navigation on sign-in', async () => {
    const { wrapper } = await mountApp('/sign-in')

    expect(wrapper.find('nav[aria-label="主要導覽"]').exists()).toBe(false)
  })
})
