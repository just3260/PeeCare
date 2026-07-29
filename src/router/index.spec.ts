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

  it('resolves the settings route', async () => {
    const router = createTestRouter()
    router.push('/settings')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('settings')
    expect(router.currentRoute.value.path).toBe('/settings')
  })

  it('redirects the legacy devices path to settings', async () => {
    const router = createTestRouter()
    router.push('/devices')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/settings')
    expect(router.currentRoute.value.name).toBe('settings')
  })

  it('no longer registers a component-backed devices route', () => {
    expect(routes.some((route) => route.name === 'devices')).toBe(false)
  })
})
