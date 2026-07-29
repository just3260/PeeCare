import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

import BottomNavigation from './BottomNavigation.vue'
import { routes } from '@/router'

async function mountWithRouter(path = '/') {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  return mount(BottomNavigation, { global: { plugins: [router] } })
}

describe('BottomNavigation', () => {
  it('renders exactly five entries in the fixed order with their target routes', async () => {
    const wrapper = await mountWithRouter()
    const links = wrapper.findAll('.bottom-nav__item')

    expect(links).toHaveLength(5)
    expect(links.map((link) => link.attributes('href'))).toEqual([
      '/history',
      '/stats',
      '/',
      '/notifications',
      '/settings',
    ])
    expect(links.map((link) => link.get('.bottom-nav__label').text())).toEqual([
      '歷史',
      '統計',
      '首頁',
      '通知',
      '設定',
    ])
  })

  it('renders the home entry in the centre, aligned with the other entries', async () => {
    const wrapper = await mountWithRouter()
    const links = wrapper.findAll('.bottom-nav__item')
    const home = links[2]

    expect(home.attributes('href')).toBe('/')
    expect(home.classes()).not.toContain('bottom-nav__item--home')
  })

  it('renders both an icon and a text label for every entry', async () => {
    const wrapper = await mountWithRouter()
    const links = wrapper.findAll('.bottom-nav__item')

    for (const link of links) {
      expect(link.find('svg').exists()).toBe(true)
      expect(link.get('.bottom-nav__label').text().length).toBeGreaterThan(0)
    }
  })

  it('exposes an accessible name on every entry', async () => {
    const wrapper = await mountWithRouter()
    const links = wrapper.findAll('.bottom-nav__item')

    for (const link of links) {
      expect((link.attributes('aria-label')?.length ?? 0)).toBeGreaterThan(0)
    }
  })

  it('marks only the active route entry with aria-current="page"', async () => {
    const wrapper = await mountWithRouter('/stats')
    const links = wrapper.findAll('.bottom-nav__item')

    const current = links.filter((link) => link.attributes('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].attributes('href')).toBe('/stats')
  })

  it('no longer renders a standalone devices navigation entry', async () => {
    const wrapper = await mountWithRouter()

    expect(wrapper.find('a[href="/devices"]').exists()).toBe(false)
  })
})
