import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

import BottomNavigation from './BottomNavigation.vue'
import { routes } from '@/router'

function mountWithRouter() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  return mount(BottomNavigation, { global: { plugins: [router] } })
}

describe('BottomNavigation', () => {
  it('marks history, devices, and notifications as aria-disabled', () => {
    const wrapper = mountWithRouter()
    const disabled = wrapper.findAll('[aria-disabled="true"]')

    expect(disabled).toHaveLength(3)
    const labels = disabled.map((node) => node.text())
    expect(labels).toEqual(['歷史', '裝置', '通知'])
  })

  it('exposes an enabled home navigation control', () => {
    const wrapper = mountWithRouter()
    const home = wrapper.get('a.bottom-nav__item--active')

    expect(home.attributes('aria-disabled')).toBeUndefined()
    expect(home.text()).toBe('首頁')
  })
})
