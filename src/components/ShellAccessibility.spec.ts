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
  it('exposes header and main landmarks', () => {
    const wrapper = mountHome()

    expect(wrapper.find('header').exists()).toBe(true)
    expect(wrapper.find('main').exists()).toBe(true)
  })
})
