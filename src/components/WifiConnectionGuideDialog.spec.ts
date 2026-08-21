import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'

import WifiConnectionGuideDialog from './WifiConnectionGuideDialog.vue'

const expectedStepCopy = [
  ['設定模式'],
  ['PeeCare', '臨時 Wi-Fi'],
  ['設定頁'],
  ['選擇', 'Wi-Fi', '密碼'],
  ['斷開', '臨時網路', '切換'],
  ['恢復', '網路', 'Web App'],
]

afterEach(() => {
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

function mountDialog(open = true) {
  return mount(WifiConnectionGuideDialog, {
    attachTo: document.body,
    props: { open },
  })
}

function element(selector: string): HTMLElement {
  const result = document.querySelector<HTMLElement>(selector)
  if (!result) {
    throw new Error(`Expected ${selector} to exist`)
  }
  return result
}

function click(target: Element) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function pressTab(target: Element, shiftKey = false) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  )
}

function expectCloseWithoutPayload(wrapper: VueWrapper) {
  expect(wrapper.emitted('close')).toEqual([[]])
}

describe('WifiConnectionGuideDialog single-page illustrated guide', () => {
  it('shows all six text-described steps in the agreed order inside one scrolling region', () => {
    mountDialog()

    const dialog = element('[data-test="wifi-guide-dialog"]')
    const scrollRegion = element('[data-test="wifi-guide-scroll-region"]')
    const steps = [...scrollRegion.querySelectorAll<HTMLElement>('[data-test="wifi-guide-step"]')]

    expect(dialog.contains(scrollRegion)).toBe(true)
    expect(dialog.querySelectorAll('[data-test="wifi-guide-scroll-region"]')).toHaveLength(1)
    expect(steps).toHaveLength(6)
    expectedStepCopy.forEach((fragments, index) => {
      fragments.forEach((fragment) => expect(steps[index].textContent).toContain(fragment))
    })
    expect(steps.map((step) => step.textContent).join('\n')).not.toMatch(
      /2\.4\s*GHz|5\s*GHz|SSID|https?:\/\/|LED|\d+\s*(秒|分鐘)/i,
    )
  })

  it('uses decorative markers without relying on them as the only instruction', () => {
    mountDialog()

    const steps = [...document.querySelectorAll<HTMLElement>('[data-test="wifi-guide-step"]')]
    const markers = [...document.querySelectorAll<HTMLElement>('[data-test="wifi-guide-step-marker"]')]

    expect(markers).toHaveLength(6)
    markers.forEach((marker) => expect(marker.getAttribute('aria-hidden')).toBe('true'))
    steps.forEach((step) => expect(step.textContent?.trim().length).toBeGreaterThan(0))
  })

  it('keeps the heading and acknowledgement outside the sole scroll region and exposes no carousel controls', () => {
    mountDialog()

    const surface = element('[data-test="wifi-guide-surface"]')
    const header = element('[data-test="wifi-guide-header"]')
    const scrollRegion = element('[data-test="wifi-guide-scroll-region"]')
    const footer = element('[data-test="wifi-guide-footer"]')

    expect(surface.classList.contains('wifi-guide-dialog__surface')).toBe(true)
    expect(scrollRegion.classList.contains('wifi-guide-dialog__scroll-region')).toBe(true)
    expect([...surface.children]).toEqual(expect.arrayContaining([header, scrollRegion, footer]))
    expect(scrollRegion.contains(element('[data-test="wifi-guide-title"]'))).toBe(false)
    expect(scrollRegion.contains(element('[data-test="wifi-guide-acknowledge"]'))).toBe(false)
    expect(surface.textContent).not.toMatch(/上一頁|下一頁/)
    expect(surface.querySelector('[aria-current="step"], [data-test="wifi-guide-pagination"]')).toBeNull()
  })
})

describe('WifiConnectionGuideDialog accessible modal interaction', () => {
  it('provides modal dialog semantics and a visible accessible title', () => {
    mountDialog()

    const dialog = element('[data-test="wifi-guide-dialog"]')
    const title = element('[data-test="wifi-guide-title"]')

    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(title.textContent).toBe('Wi-Fi 連線說明')
    expect(title.id).not.toBe('')
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
  })

  it('emits a payload-free close event from the close button and acknowledgement action', async () => {
    const closeButtonWrapper = mountDialog()
    click(element('[data-test="wifi-guide-close"]'))
    await nextTick()
    expectCloseWithoutPayload(closeButtonWrapper)
    closeButtonWrapper.unmount()

    const acknowledgeWrapper = mountDialog()
    click(element('[data-test="wifi-guide-acknowledge"]'))
    await nextTick()
    expectCloseWithoutPayload(acknowledgeWrapper)
  })

  it('emits close for Escape', async () => {
    const wrapper = mountDialog()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()

    expectCloseWithoutPayload(wrapper)
  })

  it('emits close only when the overlay itself is activated', async () => {
    const wrapper = mountDialog()
    const overlay = element('[data-test="wifi-guide-overlay"]')

    click(element('[data-test="wifi-guide-surface"]'))
    await nextTick()
    expect(wrapper.emitted('close')).toBeUndefined()

    click(overlay)
    await nextTick()
    expectCloseWithoutPayload(wrapper)
  })

  it('moves initial focus to close and traps forward and reverse Tab navigation', async () => {
    mountDialog()
    await nextTick()

    const closeButton = element('[data-test="wifi-guide-close"]')
    const acknowledgeButton = element('[data-test="wifi-guide-acknowledge"]')
    expect(document.activeElement).toBe(closeButton)

    acknowledgeButton.focus()
    pressTab(acknowledgeButton)
    expect(document.activeElement).toBe(closeButton)

    closeButton.focus()
    pressTab(closeButton, true)
    expect(document.activeElement).toBe(acknowledgeButton)
  })

  it('restores focus to the connected element that was active before opening', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = '開啟說明'
    document.body.append(trigger)
    trigger.focus()
    const wrapper = mountDialog(false)

    await wrapper.setProps({ open: true })
    expect(document.activeElement).toBe(element('[data-test="wifi-guide-close"]'))

    click(element('[data-test="wifi-guide-close"]'))
    await wrapper.setProps({ open: false })

    expect(document.activeElement).toBe(trigger)
  })

  it('restores the previous body overflow when closed or unmounted while open', async () => {
    document.body.style.overflow = 'scroll'
    const wrapper = mountDialog()
    await nextTick()
    expect(document.body.style.overflow).toBe('hidden')

    await wrapper.setProps({ open: false })
    expect(document.body.style.overflow).toBe('scroll')

    await wrapper.setProps({ open: true })
    expect(document.body.style.overflow).toBe('hidden')
    wrapper.unmount()
    expect(document.body.style.overflow).toBe('scroll')
  })
})
