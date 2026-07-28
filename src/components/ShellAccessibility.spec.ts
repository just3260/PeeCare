import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

import HomeView from '@/views/HomeView.vue'
import { routes } from '@/router'

function mountHome() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  return mount(HomeView, { global: { plugins: [router] } })
}

describe('shell landmarks and accessibility', () => {
  it('exposes header, main, and navigation landmarks', () => {
    const wrapper = mountHome()

    expect(wrapper.find('header').exists()).toBe(true)
    expect(wrapper.find('main').exists()).toBe(true)

    const nav = wrapper.find('nav')
    expect(nav.exists()).toBe(true)
    expect(nav.attributes('aria-label')).toBe('主要導覽')
  })

  it('gives the enabled home control an accessible PeeCare label', () => {
    const wrapper = mountHome()
    const home = wrapper.get('a.bottom-nav__item--active')

    expect(home.attributes('aria-label')).toContain('PeeCare')
  })
})
