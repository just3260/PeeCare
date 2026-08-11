import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createTestToolServer,
  loadTestToolConfig,
} from './test-tool.mjs'

const WEB_ORIGIN = 'https://petcare-c7483.web.app'
const INGESTION_ORIGIN =
  'https://peecare-ingestion-development-348528459946.asia-east1.run.app'
const MEMBER_ORIGIN =
  'https://peecare-member-development-348528459946.asia-east1.run.app'
const SECRET = 'development-secret-value'

const openServers: Server[] = []
const temporaryDirectories: string[] = []

function cloudEnvironment(secretFile: string): NodeJS.ProcessEnv {
  return {
    PEECARE_TEST_TOOL_PROFILE: 'development-cloud',
    PEECARE_DEVELOPMENT_WEB_ORIGIN: WEB_ORIGIN,
    PEECARE_DEVELOPMENT_INGESTION_ORIGIN: INGESTION_ORIGIN,
    PEECARE_DEVELOPMENT_MEMBER_ORIGIN: MEMBER_ORIGIN,
    PEECARE_TEST_TOOL_INGESTION_SECRET_FILE: secretFile,
  }
}

function secretFile(contents = SECRET) {
  const directory = mkdtempSync(join(tmpdir(), 'peecare-test-tool-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'ingestion-secret')
  writeFileSync(path, contents, { mode: 0o600 })
  return path
}

async function startServer(config: ReturnType<typeof loadTestToolConfig>, fetchImpl = vi.fn()) {
  const server = createTestToolServer({ config, fetchImpl })
  openServers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected TCP address')
  return { origin: `http://127.0.0.1:${address.port}`, fetchImpl }
}

async function send(origin: string, payload: unknown) {
  return fetch(`${origin}/api/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function sendWithHeaders(
  origin: string,
  payload: unknown,
  headers: Record<string, string>,
) {
  return fetch(`${origin}/api/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
}

async function sendWithHost(origin: string, payload: unknown, host: string) {
  const url = new URL(origin)
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: '/api/send',
        method: 'POST',
        headers: { Host: host, 'Content-Type': 'application/json' },
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
      },
    )
    request.on('error', reject)
    request.end(JSON.stringify(payload))
  })
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  )
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('test tool startup profiles', () => {
  it('defaults to the existing local profile and rejects unknown profiles', () => {
    expect(loadTestToolConfig({})).toEqual({ profile: 'local' })
    expect(() => loadTestToolConfig({ PEECARE_TEST_TOOL_PROFILE: 'cloud' })).toThrow(
      'Test tool profile must be local or development-cloud.',
    )
  })

  it.each([
    ['missing Web origin', { PEECARE_DEVELOPMENT_WEB_ORIGIN: undefined }],
    ['wrong Web origin', { PEECARE_DEVELOPMENT_WEB_ORIGIN: 'https://example.test' }],
    ['HTTP ingestion origin', { PEECARE_DEVELOPMENT_INGESTION_ORIGIN: 'http://example.test' }],
    ['ingestion origin with a path', { PEECARE_DEVELOPMENT_INGESTION_ORIGIN: `${INGESTION_ORIGIN}/health` }],
    ['wrong ingestion service', { PEECARE_DEVELOPMENT_INGESTION_ORIGIN: MEMBER_ORIGIN }],
    ['wrong member service', { PEECARE_DEVELOPMENT_MEMBER_ORIGIN: INGESTION_ORIGIN }],
    ['missing secret file', { PEECARE_TEST_TOOL_INGESTION_SECRET_FILE: undefined }],
  ])('fails closed for %s before server creation', (_label, overrides) => {
    expect(() =>
      loadTestToolConfig({ ...cloudEnvironment(secretFile()), ...overrides }),
    ).toThrow(/Development-cloud test tool configuration is invalid\./)
  })

  it('rejects an empty secret file without disclosing its path or content', () => {
    const path = secretFile('   \n')

    expect(() => loadTestToolConfig(cloudEnvironment(path))).toThrow(
      'Development-cloud test tool configuration is invalid.',
    )
  })

  it('rejects a missing or non-operator-only secret file', () => {
    const missingPath = join(tmpdir(), 'peecare-test-tool-missing-secret')
    const sharedPath = secretFile(SECRET)
    chmodSync(sharedPath, 0o644)

    expect(() => loadTestToolConfig(cloudEnvironment(missingPath))).toThrow(
      'Development-cloud test tool configuration is invalid.',
    )
    expect(() => loadTestToolConfig(cloudEnvironment(sharedPath))).toThrow(
      'Development-cloud test tool configuration is invalid.',
    )
  })

  it.each(['unsafe\nheader', '密碼不應通過']) (
    'rejects a secret that is unsafe to place in an HTTP Authorization header',
    (unsafeSecret) => {
      expect(() =>
        loadTestToolConfig(cloudEnvironment(secretFile(unsafeSecret))),
      ).toThrow('Development-cloud test tool configuration is invalid.')
    },
  )

  it('does not accept a forged development-cloud configuration object', () => {
    expect(() =>
      createTestToolServer({
        config: {
          profile: 'development-cloud',
          origins: { web: WEB_ORIGIN, ingestion: INGESTION_ORIGIN, member: MEMBER_ORIGIN },
        } as ReturnType<typeof loadTestToolConfig>,
      }),
    ).toThrow('A validated test tool configuration is required.')
  })
})

describe('development-cloud request boundary', () => {
  it('serves only sanitized profile and approved origins from config', async () => {
    const config = loadTestToolConfig(cloudEnvironment(secretFile()))
    const { origin } = await startServer(config)

    const response = await fetch(`${origin}/api/config`)

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({
      profile: 'development-cloud',
      origins: {
        web: WEB_ORIGIN,
        ingestion: INGESTION_ORIGIN,
        member: MEMBER_ORIGIN,
      },
    })
    expect(body).not.toContain(SECRET)
  })

  it.each([
    ['foreign host', { method: 'GET', url: 'https://example.test/health' }],
    ['wrong path', { method: 'GET', url: `${INGESTION_ORIGIN}/metrics` }],
    ['legacy health path', { method: 'GET', url: `${INGESTION_ORIGIN}/healthz` }],
    ['wrong method', { method: 'POST', url: `${MEMBER_ORIGIN}/health` }],
    ['query-bearing URL', { method: 'GET', url: `${INGESTION_ORIGIN}/health?secret=1` }],
    ['caller Authorization', { method: 'POST', url: `${INGESTION_ORIGIN}/v1/emqx/events`, headers: { Authorization: 'Bearer browser-secret' }, body: '{}' }],
    ['live Firestore', { method: 'GET', url: 'https://firestore.googleapis.com/v1/projects/petcare-c7483/databases/(default)/documents/devices/PC-1' }],
  ])('rejects %s before fetch', async (_label, payload) => {
    const fetchImpl = vi.fn()
    const config = loadTestToolConfig(cloudEnvironment(secretFile()))
    const { origin } = await startServer(config, fetchImpl)

    const response = await send(origin, payload)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: 'Cloud operation is not allowed.' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['foreign Origin', { 'content-type': 'application/json', origin: 'https://attacker.example' }],
    ['cross-site fetch metadata', { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }],
    ['simple request content type', { 'content-type': 'text/plain' }],
  ])('rejects a %s before fetch', async (_label, headers) => {
    const fetchImpl = vi.fn()
    const config = loadTestToolConfig(cloudEnvironment(secretFile()))
    const { origin } = await startServer(config, fetchImpl)
    const payload = { method: 'POST', url: `${INGESTION_ORIGIN}/v1/emqx/events`, headers: { 'content-type': 'application/json' }, body: '{}' }

    const response = await sendWithHeaders(origin, payload, headers)

    expect(response.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a non-loopback Host before fetch', async () => {
    const fetchImpl = vi.fn()
    const config = loadTestToolConfig(cloudEnvironment(secretFile()))
    const { origin } = await startServer(config, fetchImpl)
    const payload = { method: 'POST', url: `${INGESTION_ORIGIN}/v1/emqx/events`, headers: { 'content-type': 'application/json' }, body: '{}' }

    const response = await sendWithHost(origin, payload, 'attacker.example')

    expect(response.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['ingestion', `${INGESTION_ORIGIN}/health`],
    ['member', `${MEMBER_ORIGIN}/health`],
  ])('forwards the approved %s health request without credentials', async (_label, url) => {
    const fetchImpl = vi.fn(async () => new Response('healthy', { status: 200, statusText: 'OK' }))
    const config = loadTestToolConfig(cloudEnvironment(secretFile()))
    const { origin } = await startServer(config, fetchImpl)

    const response = await send(origin, { method: 'GET', url })

    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledWith(url, {
      method: 'GET',
      headers: {},
      body: undefined,
      redirect: 'error',
    })
  })

  it('injects the mounted secret only for the approved event and removes it from the response', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) =>
      new Response(`accepted ${String((init.headers as Record<string, string>).Authorization)}`, {
        status: 201,
        statusText: 'Created',
      }),
    )
    const config = loadTestToolConfig(cloudEnvironment(secretFile(`${SECRET}\n`)))
    const { origin } = await startServer(config, fetchImpl)
    const envelope = JSON.stringify({ topic: 'products/pc-mini/devices/PC-BETA-0001/events/urination' })

    const response = await send(origin, {
      method: 'POST',
      url: `${INGESTION_ORIGIN}/v1/emqx/events`,
      headers: { 'content-type': 'application/json' },
      body: envelope,
    })

    expect(fetchImpl).toHaveBeenCalledWith(`${INGESTION_ORIGIN}/v1/emqx/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: envelope,
      redirect: 'error',
    })
    const responseText = await response.text()
    expect(responseText).not.toContain(SECRET)
    expect(JSON.parse(responseText)).toMatchObject({ ok: true, status: 201, statusText: '' })
  })

  it('sanitizes an upstream failure that contains the mounted secret', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`upstream rejected Bearer ${SECRET}`)
    })
    const config = loadTestToolConfig(cloudEnvironment(secretFile()))
    const { origin } = await startServer(config, fetchImpl)

    const response = await send(origin, {
      method: 'POST',
      url: `${INGESTION_ORIGIN}/v1/emqx/events`,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    expect(await response.text()).not.toContain(SECRET)
  })

  it('does not return the mounted secret when upstream reflects it as an eventId', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ eventId: SECRET }), { status: 201, statusText: 'Created' }),
    )
    const config = loadTestToolConfig(cloudEnvironment(secretFile()))
    const { origin } = await startServer(config, fetchImpl)

    const response = await send(origin, {
      method: 'POST',
      url: `${INGESTION_ORIGIN}/v1/emqx/events`,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    expect(await response.text()).not.toContain(SECRET)
  })
})

describe('local profile regression', () => {
  it('preserves loopback proxy behavior and caller headers', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const { origin } = await startServer(loadTestToolConfig({}), fetchImpl)
    const payload = {
      method: 'POST',
      url: 'http://127.0.0.1:8086/v1/emqx/events',
      headers: { Authorization: 'Bearer local-secret', 'content-type': 'application/json' },
      body: '{}',
    }

    expect((await send(origin, payload)).status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledWith(payload.url, {
      method: payload.method,
      headers: payload.headers,
      body: payload.body,
      redirect: 'error',
    })
  })
})
