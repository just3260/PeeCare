import { parseDevelopmentInventory } from './environment.mjs'
import { developmentSeedIdentity } from './seed.mjs'

const ALLOWED_PROVIDER_IDS = new Set(['password', 'phone', 'google.com', 'apple.com'])

export class DevelopmentReadinessError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DevelopmentReadinessError'
    this.code = code
  }
}

function requireValue(environment, fieldName) {
  const value = environment[fieldName]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DevelopmentReadinessError(
      'readiness_config_missing',
      `Required readiness field ${fieldName} is missing.`,
    )
  }
  return value.trim()
}

function requireList(environment, fieldName) {
  const values = requireValue(environment, fieldName)
    .split(',')
    .map((value) => value.trim())
  if (values.some((value) => value.length === 0) || new Set(values).size !== values.length) {
    throw new DevelopmentReadinessError(
      'readiness_config_invalid',
      `${fieldName} must contain unique, non-empty comma-separated values.`,
    )
  }
  return values
}

function parseReadinessConfiguration(environment) {
  const providers = requireList(environment, 'PEECARE_DEVELOPMENT_AUTH_PROVIDERS')
  if (providers.some((provider) => !ALLOWED_PROVIDER_IDS.has(provider))) {
    throw new DevelopmentReadinessError(
      'readiness_config_invalid',
      'Development Auth provider list contains an unsupported provider ID.',
    )
  }
  return Object.freeze({
    providers,
    authorizedDomains: requireList(
      environment,
      'PEECARE_DEVELOPMENT_AUTHORIZED_DOMAINS',
    ),
    webApiKey: requireValue(environment, 'PEECARE_DEVELOPMENT_WEB_API_KEY'),
  })
}

export async function runDevelopmentReadiness({ environment, adapter, write }) {
  const inventory = parseDevelopmentInventory(environment)
  const expected = parseReadinessConfiguration(environment)
  const auth = await adapter.readAuthConfiguration()

  if (expected.providers.some((provider) => !auth.enabledProviders.includes(provider))) {
    throw new DevelopmentReadinessError(
      'auth_provider_not_ready',
      'One or more approved Firebase Auth providers are not enabled.',
    )
  }
  if (
    expected.authorizedDomains.some((domain) => !auth.authorizedDomains.includes(domain))
  ) {
    throw new DevelopmentReadinessError(
      'authorized_domain_not_ready',
      'One or more approved Firebase Auth domains are not authorized.',
    )
  }

  const indexes = await adapter.readRequiredIndexes()
  if (indexes.length === 0 || indexes.some((index) => index.state !== 'READY')) {
    throw new DevelopmentReadinessError(
      'firestore_index_not_ready',
      'A required Firestore index is missing or not READY.',
    )
  }

  const identity = developmentSeedIdentity(inventory.projectId)
  const probes = await adapter.runRulesProbes({
    ...identity,
    webApiKey: expected.webApiKey,
  })
  if (
    !probes.ownerReadAllowed ||
    !probes.nonOwnerReadDenied ||
    !probes.anonymousReadDenied ||
    !probes.clientWriteDenied
  ) {
    throw new DevelopmentReadinessError(
      'firestore_rules_probe_failed',
      'A deployed Firestore Rules readiness probe did not satisfy the authorization contract.',
    )
  }

  const summary = Object.freeze({
    status: 'ready',
    projectId: inventory.projectId,
    auth: Object.freeze({
      providers: Object.freeze([...expected.providers]),
      authorizedDomains: expected.authorizedDomains.length,
    }),
    firestore: Object.freeze({
      indexesReady: indexes.length,
      ownerRead: 'allowed',
      nonOwnerRead: 'denied',
      anonymousRead: 'denied',
      clientWrite: 'denied',
    }),
  })
  write(JSON.stringify(summary))
  return summary
}
