import { describe, it, expect, vi } from 'vitest'

import { createProtectedResourceRegistry } from './protected-resource-registry'

describe('protected resource registry', () => {
  it('runs every registered disposer and clears the ledger', () => {
    const registry = createProtectedResourceRegistry()
    const order: string[] = []
    registry.register(() => order.push('a'))
    registry.register(() => order.push('b'))
    expect(registry.size()).toBe(2)

    registry.disposeAll()

    expect(order).toEqual(['a', 'b'])
    expect(registry.size()).toBe(0)
  })

  it('is a no-op on a second disposeAll', () => {
    const registry = createProtectedResourceRegistry()
    const disposer = vi.fn()
    registry.register(disposer)

    registry.disposeAll()
    registry.disposeAll()

    expect(disposer).toHaveBeenCalledTimes(1)
  })

  it('allows a mounted resource to unregister without running its disposer', () => {
    const registry = createProtectedResourceRegistry()
    const disposer = vi.fn()
    const unregister = registry.register(disposer)

    expect(registry.size()).toBe(1)
    unregister()
    unregister()

    expect(registry.size()).toBe(0)
    registry.disposeAll()
    expect(disposer).not.toHaveBeenCalled()
  })

  it('isolates a throwing disposer so the rest still run', () => {
    const registry = createProtectedResourceRegistry()
    const after = vi.fn()
    registry.register(() => {
      throw new Error('listener blew up')
    })
    registry.register(after)

    expect(() => registry.disposeAll()).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
    expect(registry.size()).toBe(0)
  })

  it('keeps disposers registered during teardown for the next teardown', () => {
    const registry = createProtectedResourceRegistry()
    const later = vi.fn()
    registry.register(() => {
      // A disposer that registers new work must not be run in the same pass.
      registry.register(later)
    })

    registry.disposeAll()
    expect(later).not.toHaveBeenCalled()
    expect(registry.size()).toBe(1)

    registry.disposeAll()
    expect(later).toHaveBeenCalledTimes(1)
  })
})
