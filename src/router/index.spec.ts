import { describe, it, expect } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'

import { routes } from './index'

function createTestRouter() {
  return createRouter({ history: createMemoryHistory(), routes })
}

describe('router', () => {
  it('renders the home application shell at the root route', async () => {
    const router = createTestRouter()
    router.push('/')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('home')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('redirects an unsupported path back to the root route', async () => {
    const router = createTestRouter()
    router.push('/unknown-path')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/')
    expect(router.currentRoute.value.name).toBe('home')
  })
})
