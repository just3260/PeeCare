import { parseDevelopmentInventory } from './environment.mjs'
import { developmentSeedIdentity } from './seed.mjs'

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

function parseReadinessConfiguration(environment, projectId) {
  const authorizedDomains = requireList(
    environment,
    'PEECARE_DEVELOPMENT_AUTHORIZED_DOMAINS',
  )
  const requiredDomains = [
    `${projectId}.firebaseapp.com`,
    `${projectId}.web.app`,
  ]
  if (
    authorizedDomains.length !== requiredDomains.length ||
    requiredDomains.some((domain) => !authorizedDomains.includes(domain))
  ) {
    throw new DevelopmentReadinessError(
      'readiness_config_invalid',
      'Development authorized-domain inventory must match the approved Firebase action and Hosting domains.',
    )
  }
  return Object.freeze({
    authorizedDomains: Object.freeze([...authorizedDomains]),
    webApiKey: requireValue(environment, 'PEECARE_DEVELOPMENT_WEB_API_KEY'),
  })
}

export async function runDevelopmentReadiness({ environment, adapter, write }) {
  const inventory = parseDevelopmentInventory(environment)
  const expected = parseReadinessConfiguration(environment, inventory.projectId)
  const auth = await adapter.readAuthConfiguration()

  if (!auth.enabledProviders.includes(inventory.authProvider)) {
    throw new DevelopmentReadinessError(
      'auth_provider_not_ready',
      'One or more approved Firebase Auth providers are not enabled.',
    )
  }
  if (
    auth.emailEnabled !== true ||
    auth.passwordRequired !== false ||
    auth.allowDuplicateEmails !== false
  ) {
    throw new DevelopmentReadinessError(
      'email_link_not_ready',
      'Firebase Email Link configuration does not match the approved passwordless identity contract.',
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
      provider: Object.freeze({ id: inventory.authProvider, enabled: true }),
      emailLink: Object.freeze({
        enabled: true,
        passwordRequired: false,
        duplicateEmailsAllowed: false,
      }),
      authorizedDomains: Object.freeze({
        required: expected.authorizedDomains.length,
        ready: true,
      }),
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
