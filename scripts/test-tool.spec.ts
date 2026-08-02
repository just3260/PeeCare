import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const DEVICE_STORAGE_KEY = 'peecare.test-tool.devices'

const html = readFileSync(resolve(process.cwd(), 'scripts/test-tool.html'), 'utf8')
const openDocuments: JSDOM[] = []

function loadTool() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:5055/',
  })
  openDocuments.push(dom)
  return dom.window.document
}

function element<T extends HTMLElement>(document: Document, id: string) {
  const result = document.getElementById(id)
  expect(result, `expected #${id} to exist`).toBeInstanceOf(document.defaultView?.HTMLElement)
  return result as T
}

function deviceCards(document: Document) {
  return [...document.querySelectorAll<HTMLElement>('#device-list .device-card')]
}

function storedDevices(document: Document) {
  const raw = document.defaultView?.localStorage.getItem(DEVICE_STORAGE_KEY)
  return raw === null || raw === undefined ? [] : JSON.parse(raw)
}

afterEach(() => {
  for (const dom of openDocuments.splice(0)) dom.window.close()
})

/** 讓頁面內尚未完成的送出流程跑完，避免 JSDOM 被關掉後才收到回應。 */
function flushPending() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('local test tool settings navigation', () => {
  it('opens on the main view with an accessible gear button', () => {
    const document = loadTool()
    const mainView = element<HTMLElement>(document, 'main-view')
    const settingsView = element<HTMLElement>(document, 'settings-view')
    const settingsButton = element<HTMLButtonElement>(document, 'open-settings')
    const icon = settingsButton.querySelector('svg')

    expect(mainView.hidden).toBe(false)
    expect(settingsView.hidden).toBe(true)
    expect(settingsButton.tagName).toBe('BUTTON')
    expect(settingsButton.getAttribute('aria-label')).toBe('開啟共用設定')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  })

  it('switches between views and moves focus to the active navigation control', () => {
    const document = loadTool()
    const mainView = element<HTMLElement>(document, 'main-view')
    const settingsView = element<HTMLElement>(document, 'settings-view')
    const settingsButton = element<HTMLButtonElement>(document, 'open-settings')
    const backButton = element<HTMLButtonElement>(document, 'close-settings')

    settingsButton.focus()
    settingsButton.click()

    expect(mainView.hidden).toBe(true)
    expect(settingsView.hidden).toBe(false)
    expect(document.activeElement).toBe(backButton)

    backButton.click()

    expect(mainView.hidden).toBe(false)
    expect(settingsView.hidden).toBe(true)
    expect(document.activeElement).toBe(settingsButton)
  })

  it('keeps every shared control and the run-all action in the settings view', () => {
    const document = loadTool()
    const settingsView = element<HTMLElement>(document, 'settings-view')
    const sharedControlIds = [
      'ingestionBase', 'firestoreBase', 'projectId', 'secret', 'productModel',
      'deviceId', 'bootId', 'ownerUid', 'clientId', 'username', 'qos', 'seq',
      'seqAuto', 'eventId', 'evt-auto', 'fw', 'timeMode', 'recorded', 'broker',
      'brokerAuto', 'runAll',
    ]

    for (const id of sharedControlIds) {
      expect(settingsView.contains(element(document, id)), `expected #${id} inside settings view`).toBe(true)
    }
  })

  it('preserves edited settings and uses them when previewing after a round trip', async () => {
    const document = loadTool()
    const settingsButton = element<HTMLButtonElement>(document, 'open-settings')
    const backButton = element<HTMLButtonElement>(document, 'close-settings')
    const ingestionBase = element<HTMLInputElement>(document, 'ingestionBase')
    const sequenceAuto = element<HTMLInputElement>(document, 'seqAuto')

    settingsButton.click()
    ingestionBase.value = 'http://127.0.0.1:9090/'
    sequenceAuto.checked = false
    backButton.click()
    settingsButton.click()

    expect(ingestionBase.value).toBe('http://127.0.0.1:9090/')
    expect(sequenceAuto.checked).toBe(false)

    backButton.click()
    const healthPreview = document.querySelector<HTMLButtonElement>('#main-view .card button.ghost')
    healthPreview?.click()
    // curl 區塊展開會非同步觸發 toggle，等它跑完再結束，才不會在 DOM 關閉後才重繪。
    await flushPending()

    expect(element<HTMLElement>(document, 'curl-health').textContent).toContain(
      "http://127.0.0.1:9090/healthz",
    )
  })
})

describe('local test tool device simulator', () => {
  it('seeds one device unit with a full-width machine button and a battery icon beside the gear', () => {
    const document = loadTool()
    const cards = deviceCards(document)

    expect(cards).toHaveLength(1)
    expect(cards[0].querySelector('.device-card-name')?.textContent).toBe('PC-000001')

    const urination = cards[0].querySelector<HTMLButtonElement>('.device-card-body button[data-event="urination"]')
    const battery = cards[0].querySelector<HTMLButtonElement>('.device-card-head button[data-event="battery"]')

    expect(urination?.querySelector('img')?.getAttribute('src')).toBe('/machine.png')
    expect(urination?.getAttribute('aria-label')).toContain('排尿事件')
    expect(battery?.getAttribute('aria-label')).toContain('電量事件')
    // 兩顆按鈕都不再帶文字標籤，電池與齒輪同為 icon-button
    expect(urination?.textContent?.trim()).toBe('')
    expect(battery?.textContent?.trim()).toBe('🔋')
    expect(battery?.className).toBe('icon-button')
    expect(battery?.nextElementSibling?.className).toContain('device-settings')
    // 回應區塊緊接在排尿按鈕右邊
    expect(urination?.nextElementSibling?.className).toContain('result')
  })

  it('adds a unit and stores every unit in localStorage', () => {
    const document = loadTool()

    element<HTMLButtonElement>(document, 'add-device').click()

    expect(deviceCards(document)).toHaveLength(2)
    expect(storedDevices(document)).toHaveLength(2)
  })

  it('edits a unit in its own settings view and returns focus to the opening control', () => {
    const document = loadTool()
    const mainView = element<HTMLElement>(document, 'main-view')
    const deviceView = element<HTMLElement>(document, 'device-view')
    const gear = deviceCards(document)[0].querySelector<HTMLButtonElement>('button.device-settings')

    gear?.focus()
    gear?.click()

    expect(mainView.hidden).toBe(true)
    expect(deviceView.hidden).toBe(false)
    expect(element<HTMLInputElement>(document, 'unit-deviceId').value).toBe('PC-000001')
    expect(element<HTMLInputElement>(document, 'unit-flush').value).toBe('3000')
    expect(element<HTMLInputElement>(document, 'unit-pump').value).toBe('5000')
    expect(element<HTMLInputElement>(document, 'unit-battery-level').value).toBe('75')
    expect(element<HTMLInputElement>(document, 'unit-battery-voltage').value).toBe('3975')

    const deviceId = element<HTMLInputElement>(document, 'unit-deviceId')
    deviceId.value = 'PC-000009'
    deviceId.dispatchEvent(new (document.defaultView as Window & typeof globalThis).Event('input'))

    expect(deviceCards(document)[0].querySelector('.device-card-name')?.textContent).toBe('PC-000009')
    expect(storedDevices(document)[0].deviceId).toBe('PC-000009')

    element<HTMLButtonElement>(document, 'close-device').click()

    expect(mainView.hidden).toBe(false)
    expect(deviceView.hidden).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toContain('PC-000009')
  })

  it('deletes a unit from its settings view', () => {
    const document = loadTool()

    element<HTMLButtonElement>(document, 'add-device').click()
    deviceCards(document)[1].querySelector<HTMLButtonElement>('button.device-settings')?.click()
    element<HTMLButtonElement>(document, 'delete-device').click()

    expect(element<HTMLElement>(document, 'main-view').hidden).toBe(false)
    expect(deviceCards(document)).toHaveLength(1)
    expect(storedDevices(document)).toHaveLength(1)
  })

  it('sends a urination event built from the unit fields and the shared settings', async () => {
    const document = loadTool()
    const view = document.defaultView as Window & typeof globalThis
    const sendRequest = vi.fn(async () => ({
      json: async () => ({ ok: true, status: 200, statusText: 'OK', elapsedMs: 1, body: '{}' }),
    }))
    view.fetch = sendRequest as unknown as typeof fetch

    element<HTMLInputElement>(document, 'seq').value = '7'
    deviceCards(document)[0].querySelector<HTMLButtonElement>('button[data-event="urination"]')?.click()
    await flushPending()

    expect(sendRequest).toHaveBeenCalledTimes(1)
    const [url, init] = sendRequest.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/send')

    const proxied = JSON.parse(String(init.body))
    expect(proxied.url).toBe('http://127.0.0.1:8086/v1/emqx/events')
    const envelope = JSON.parse(proxied.body)
    expect(envelope.topic).toBe('products/pc-mini/devices/PC-000001/events/urination')
    expect(envelope.clientId).toBe('PC-000001')
    expect(envelope.payload).toMatchObject({
      eventType: 'urination',
      deviceId: 'PC-000001',
      eventId: 'PC-000001:1:7',
      sequence: 7,
      flushDurationMs: 3000,
      pumpDurationMs: 5000,
    })
  })

  it('shakes the dog image over the machine and only sends after the shake finishes', async () => {
    const document = loadTool()
    const view = document.defaultView as Window & typeof globalThis
    let endShake = () => {}
    const finished = new Promise<void>((resolve) => {
      endShake = () => resolve()
    })
    // JSDOM 沒有 Web Animations API，補一個假的才能觀察抖動期間的畫面
    view.HTMLElement.prototype.animate = vi.fn(() => ({ finished })) as unknown as HTMLElement['animate']
    const sendRequest = vi.fn(async () => ({
      json: async () => ({ ok: true, status: 200, statusText: 'OK', elapsedMs: 1, body: '{}' }),
    }))
    view.fetch = sendRequest as unknown as typeof fetch

    const card = deviceCards(document)[0]
    card.querySelector<HTMLButtonElement>('button[data-event="urination"]')?.click()
    await flushPending()

    expect(card.querySelector('.sim-button img.sim-dog')?.getAttribute('src')).toBe('/dog.png')
    expect(sendRequest).not.toHaveBeenCalled()

    endShake()
    await flushPending()

    // 抖完就收掉狗狗，接著才打 API
    expect(card.querySelector('.sim-dog')).toBeNull()
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('reads the device document and shows its customName above the serial', async () => {
    const document = loadTool()
    const view = document.defaultView as Window & typeof globalThis
    const sendRequest = vi.fn(async () => ({
      json: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        elapsedMs: 1,
        body: JSON.stringify({ fields: { customName: { stringValue: '主浴室' } } }),
      }),
    }))
    view.fetch = sendRequest as unknown as typeof fetch

    element<HTMLButtonElement>(document, 'refresh-device-names').click()
    await flushPending()

    const proxied = JSON.parse(String((sendRequest.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(proxied.method).toBe('GET')
    expect(proxied.url).toBe(
      'http://127.0.0.1:8085/v1/projects/demo-peecare/databases/(default)/documents/devices/PC-000001',
    )

    const card = deviceCards(document)[0]
    const serial = card.querySelector<HTMLElement>('.device-card-serial')
    expect(card.querySelector('.device-card-name')?.textContent).toBe('主浴室')
    expect(serial?.textContent).toBe('裝置序號：PC-000001')
    expect(serial?.hidden).toBe(false)
    expect(card.querySelector('button.device-settings')?.getAttribute('aria-label')).toBe('主浴室 裝置設定')
  })

  it('falls back to the device serial when the document has no customName', async () => {
    const document = loadTool()
    const view = document.defaultView as Window & typeof globalThis
    view.fetch = vi.fn(async () => ({
      json: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        elapsedMs: 1,
        body: JSON.stringify({ fields: { deviceId: { stringValue: 'PC-000001' } } }),
      }),
    })) as unknown as typeof fetch

    element<HTMLButtonElement>(document, 'refresh-device-names').click()
    await flushPending()

    const card = deviceCards(document)[0]
    expect(card.querySelector('.device-card-name')?.textContent).toBe('PC-000001')
    expect(card.querySelector<HTMLElement>('.device-card-serial')?.hidden).toBe(true)
  })

  it('keeps the serial when the device document cannot be read', async () => {
    const document = loadTool()
    const view = document.defaultView as Window & typeof globalThis
    view.fetch = vi.fn(async () => ({
      json: async () => ({ ok: false, error: 'connect ECONNREFUSED' }),
    })) as unknown as typeof fetch

    element<HTMLButtonElement>(document, 'refresh-device-names').click()
    await flushPending()

    const card = deviceCards(document)[0]
    expect(card.querySelector('.device-card-name')?.textContent).toBe('PC-000001')
    expect(card.querySelector<HTMLElement>('.device-card-serial')?.hidden).toBe(true)
  })

  it('updates the device document with a mask so the custom name survives', async () => {
    const document = loadTool()
    const deviceCard = [...document.querySelectorAll<HTMLElement>('#main-view details.card')][1]

    deviceCard.querySelector<HTMLButtonElement>('button.ghost')?.click()
    // curl 區塊展開會非同步觸發 toggle，等它跑完再結束，才不會在 DOM 關閉後才重繪。
    await flushPending()

    const curl = element<HTMLElement>(document, 'curl-device').textContent ?? ''
    expect(curl).toContain('updateMask.fieldPaths=deviceId')
    expect(curl).toContain('updateMask.fieldPaths=ownerUid')
    expect(curl).not.toContain('customName')
  })

  it('sends a battery event and honours the optional voltage toggle', async () => {
    const document = loadTool()
    const view = document.defaultView as Window & typeof globalThis
    const sendRequest = vi.fn(async () => ({
      json: async () => ({ ok: true, status: 200, statusText: 'OK', elapsedMs: 1, body: '{}' }),
    }))
    view.fetch = sendRequest as unknown as typeof fetch

    deviceCards(document)[0].querySelector<HTMLButtonElement>('button.device-settings')?.click()
    const voltageToggle = element<HTMLInputElement>(document, 'unit-voltageOn')
    voltageToggle.checked = false
    voltageToggle.dispatchEvent(new view.Event('change'))
    element<HTMLButtonElement>(document, 'close-device').click()

    deviceCards(document)[0].querySelector<HTMLButtonElement>('button[data-event="battery"]')?.click()
    await flushPending()

    const [, init] = sendRequest.mock.calls[0] as unknown as [string, RequestInit]
    const envelope = JSON.parse(JSON.parse(String(init.body)).body)

    expect(envelope.topic).toBe('products/pc-mini/devices/PC-000001/status/battery')
    expect(envelope.payload).toMatchObject({ eventType: 'battery', batteryLevelPercent: 75 })
    expect(envelope.payload.batteryVoltageMv).toBeUndefined()
  })
})
