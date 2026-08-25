import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  LegacyBindPolicyError,
  validateLegacyBindArtifacts,
} from './legacy-bind-policy.mjs'

const artifactDirectory = dirname(fileURLToPath(import.meta.url))

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(artifactDirectory, relativePath), 'utf8'))
}

function artifacts() {
  return {
    inventory: readJson('device-inventory.json'),
    perDeviceAcl: readJson('acl-policy.json'),
    legacyPolicy: readJson('legacy-bind-policy.json'),
    retryFixture: readJson('fixtures/legacy-bind-retry.json'),
  }
}

function copy<T>(value: T): T {
  return structuredClone(value)
}

type JsonPath = readonly (number | string)[]

function valueAt(root: unknown, path: JsonPath): unknown {
  return path.reduce<unknown>((value, segment) => {
    if (typeof segment === 'number') {
      if (!Array.isArray(value)) throw new TypeError('Expected fixture array')
      return value[segment]
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Expected fixture object')
    }
    return Reflect.get(value, segment)
  }, root)
}

function arrayAt(root: unknown, path: JsonPath): unknown[] {
  const value = valueAt(root, path)
  if (!Array.isArray(value)) throw new TypeError('Expected fixture array')
  return value
}

function setAt(root: unknown, path: JsonPath, replacement: unknown): void {
  const property = path.at(-1)
  if (property === undefined) throw new TypeError('Fixture path must not be empty')
  const parent = valueAt(root, path.slice(0, -1))
  if (typeof property === 'number') {
    if (!Array.isArray(parent)) throw new TypeError('Expected fixture array')
    parent[property] = replacement
    return
  }
  if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) {
    throw new TypeError('Expected fixture object')
  }
  Reflect.set(parent, property, replacement)
}

describe('shared legacy bind publisher policy', () => {
  it('keeps the shared QoS 0 bind identity isolated from the canonical per-device ACL', () => {
    const loaded = artifacts()

    expect(validateLegacyBindArtifacts(loaded)).toEqual({
      sharedUsername: 'approved-legacy-device',
      sharedClientId: '68E274BD2A58',
      bindTopic: 'peecare/device/1/bind',
      retryDelaysMs: [0, 5_000, 10_000],
      telemetryPrincipal: 'device-68E274BD2A58',
      trustBoundary: 'shared-credential-no-hardware-attestation',
    })
    expect(loaded.perDeviceAcl).toEqual({
      username: 'device-68E274BD2A58',
      rules: [
        {
          permission: 'allow',
          action: 'publish',
          topic: 'products/pc-mini/devices/68E274BD2A58/events/urination',
          qos: [1],
          retain: false,
        },
        {
          permission: 'allow',
          action: 'publish',
          topic: 'products/pc-mini/devices/68E274BD2A58/status/battery',
          qos: [1],
          retain: false,
        },
        { permission: 'deny', action: 'all', topic: '#' },
      ],
    })
    expect(JSON.stringify(loaded.perDeviceAcl)).not.toContain('peecare/device/1/bind')
  })

  it.each([
    ['wrong bind topic', (value: ReturnType<typeof artifacts>) => {
      setAt(value.legacyPolicy, ['rules', 0, 'topic'], 'peecare/device/1/#')
    }],
    ['QoS 1 bind', (value: ReturnType<typeof artifacts>) => {
      setAt(value.legacyPolicy, ['rules', 0, 'qos'], [1])
    }],
    ['retained bind', (value: ReturnType<typeof artifacts>) => {
      setAt(value.legacyPolicy, ['rules', 0, 'retain'], true)
    }],
    ['missing deny-all fallback', (value: ReturnType<typeof artifacts>) => {
      arrayAt(value.legacyPolicy, ['rules']).pop()
    }],
    ['per-device principal reuse', (value: ReturnType<typeof artifacts>) => {
      setAt(value.legacyPolicy, ['identity', 'username'], 'device-68E274BD2A58')
    }],
    ['bind permission on telemetry principal', (value: ReturnType<typeof artifacts>) => {
      const bindAllow = copy(arrayAt(value.legacyPolicy, ['rules'])[0])
      arrayAt(value.perDeviceAcl, ['rules']).splice(2, 0, bindAllow)
    }],
  ])('rejects policy drift: %s', (_case, mutate) => {
    const loaded = artifacts()
    mutate(loaded)

    expect(() => validateLegacyBindArtifacts(loaded)).toThrow(LegacyBindPolicyError)
  })

  it.each([
    ['lowercase device_id', (value: ReturnType<typeof artifacts>) => {
      setAt(value.retryFixture, ['attempts', 0, 'payload', 'device_id'], '68e274bd2a58')
    }],
    ['non-eight-digit pair_code', (value: ReturnType<typeof artifacts>) => {
      setAt(value.retryFixture, ['attempts', 0, 'payload', 'pair_code'], '1234567')
    }],
    ['extra payload property', (value: ReturnType<typeof artifacts>) => {
      setAt(value.retryFixture, ['attempts', 0, 'payload', 'ownerUid'], 'member-001')
    }],
    ['rotated retry payload', (value: ReturnType<typeof artifacts>) => {
      setAt(value.retryFixture, ['attempts', 1, 'payload', 'pair_code'], '87654321')
    }],
    ['wrong retry delay', (value: ReturnType<typeof artifacts>) => {
      setAt(value.retryFixture, ['attempts', 2, 'delayMs'], 9_999)
    }],
    ['wrong retry topic', (value: ReturnType<typeof artifacts>) => {
      setAt(value.retryFixture, ['attempts', 1, 'topic'], 'peecare/device/1/status')
    }],
    ['wrong retry QoS', (value: ReturnType<typeof artifacts>) => {
      setAt(value.retryFixture, ['attempts', 1, 'qos'], 1)
    }],
    ['retained retry', (value: ReturnType<typeof artifacts>) => {
      setAt(value.retryFixture, ['attempts', 1, 'retained'], true)
    }],
    ['publish-as-ownership claim', (value: ReturnType<typeof artifacts>) => {
      setAt(value.retryFixture, ['publishConfirmsOwnership'], true)
    }],
    ['hardware-attestation claim', (value: ReturnType<typeof artifacts>) => {
      setAt(value.retryFixture, ['hardwareAttestation'], true)
    }],
  ])('rejects retry contract drift: %s', (_case, mutate) => {
    const loaded = artifacts()
    mutate(loaded)

    expect(() => validateLegacyBindArtifacts(loaded)).toThrow(LegacyBindPolicyError)
  })

  it('rejects secret-bearing artifact fields while allowing only the documented example Pair Code', () => {
    const loaded = artifacts()
    setAt(loaded.legacyPolicy, ['password'], 'must-not-be-stored')

    expect(() => validateLegacyBindArtifacts(loaded)).toThrowError(
      expect.objectContaining({ code: 'secret_material_forbidden' }),
    )

    const serializedArtifacts = [
      readFileSync(resolve(artifactDirectory, 'device-inventory.json'), 'utf8'),
      readFileSync(resolve(artifactDirectory, 'acl-policy.json'), 'utf8'),
      readFileSync(resolve(artifactDirectory, 'legacy-bind-policy.json'), 'utf8'),
      readFileSync(resolve(artifactDirectory, 'fixtures/legacy-bind-retry.json'), 'utf8'),
    ].join('\n')
    expect(serializedArtifacts).not.toMatch(
      /"(?:password|passphrase|secret|jwt|authorization|authentication|auth|oauth|cookie(?:jar)?|session(?:id)?|token|credential(?:value)?|api[_-]?(?:key|secret)|private[_-]?key|signing[_-]?key|access[_-]?key)"\s*:/i,
    )
    expect(serializedArtifacts).not.toMatch(/Bearer\s+|-----BEGIN [A-Z ]*PRIVATE KEY-----/)
    expect(serializedArtifacts).not.toMatch(
      /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:$|[^A-Za-z0-9_-])/,
    )
  })

  it.each([
    ['inventory bare secret', 'inventory', 'secret'],
    ['inventory session material', 'inventory', 'sessionId'],
    ['inventory JWT material', 'inventory', 'jwt'],
    ['per-device ACL authorization', 'perDeviceAcl', 'authorization'],
    ['per-device ACL signing key', 'perDeviceAcl', 'signingKey'],
    ['legacy policy auth material', 'legacyPolicy', 'auth'],
    ['legacy policy access key', 'legacyPolicy', 'accessKey'],
    ['retry fixture cookie material', 'retryFixture', 'cookieJar'],
    ['retry fixture compact signing key', 'retryFixture', 'signingkey'],
  ] as const)('rejects %s before artifact schema validation', (_case, artifactName, fieldName) => {
    const loaded = artifacts()
    setAt(loaded[artifactName], [fieldName], 'credential-material')

    expect(() => validateLegacyBindArtifacts(loaded)).toThrowError(
      expect.objectContaining({ code: 'secret_material_forbidden' }),
    )
  })

  it.each([
    ['JWT', 'inventory', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtZW1iZXItMDAxIn0.signaturebytes'],
    ['private key', 'perDeviceAcl', '-----BEGIN PRIVATE KEY-----\nsecret-material'],
    ['Bearer credential', 'legacyPolicy', 'Bearer resolved-credential-value'],
  ] as const)('rejects a %s value before artifact schema validation', (_case, artifactName, value) => {
    const loaded = artifacts()
    setAt(loaded[artifactName], ['note'], value)

    expect(() => validateLegacyBindArtifacts(loaded)).toThrowError(
      expect.objectContaining({ code: 'secret_material_forbidden' }),
    )
  })

  it('does not treat an author metadata key as authentication material', () => {
    const loaded = artifacts()
    setAt(loaded.legacyPolicy, ['author'], 'PeeCare development')

    expect(() => validateLegacyBindArtifacts(loaded)).toThrowError(
      expect.objectContaining({ code: 'invalid_legacy_policy' }),
    )
  })
})
