import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it } from 'vitest'

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

afterEach(() => {
  for (const dom of openDocuments.splice(0)) dom.window.close()
})

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

  it('preserves edited settings and uses them when previewing after a round trip', () => {
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

    expect(element<HTMLElement>(document, 'curl-health').textContent).toContain(
      "http://127.0.0.1:9090/healthz",
    )
  })
})
