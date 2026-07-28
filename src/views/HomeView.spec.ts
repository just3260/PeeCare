import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

import HomeView from './HomeView.vue'
import { routes } from '@/router'

function mountHomeView() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  return mount(HomeView, { global: { plugins: [router] } })
}

describe('HomeView neutral state', () => {
  it('renders the PeeCare brand and neutral no-data labels', () => {
    const wrapper = mountHomeView()
    const text = wrapper.text()

    expect(text).toContain('PeeCare')
    expect(text).toContain('尚無裝置資料')
    expect(text).toContain('待校正')
    expect(text).toContain('尚未回報')
  })

  it('does not present fabricated measurements or connection status', () => {
    const wrapper = mountHomeView()
    const text = wrapper.text()

    expect(text).not.toContain('比昨天多 8 mL')
    expect(text).not.toContain('Wi-Fi 正常')
    expect(text).not.toContain('裝置在線')
    expect(text).not.toContain('14 mL')
  })
})
