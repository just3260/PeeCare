const REQUIRED_OPERATOR_CONFIRMATION = 'APPROVE_DEVELOPMENT_FIREBASE_MUTATION'
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
const FIRESTORE_REGION_PATTERN = /^[a-z][a-z0-9-]{2,31}$/
const PRODUCTION_NAME_PATTERN = /(^|-)(prod|production)(-|$)/i
const ALLOWED_AUTH_PROVIDERS = new Set(['password', 'phone', 'google.com', 'apple.com'])

export class DevelopmentInventoryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DevelopmentInventoryError'
    this.code = code
  }
}

function requireValue(environment, fieldName) {
  const value = environment[fieldName]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DevelopmentInventoryError(
      'missing_inventory',
      `Required development inventory field ${fieldName} is missing.`,
    )
  }
  return value.trim()
}

function parseProjectList(environment, fieldName, required) {
  const raw = environment[fieldName]
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    if (!required) return new Set()
    throw new DevelopmentInventoryError(
      'missing_inventory',
      `Required development inventory field ${fieldName} is missing.`,
    )
  }

  const projectIds = raw.split(',').map((value) => value.trim())
  if (projectIds.some((value) => !PROJECT_ID_PATTERN.test(value))) {
    throw new DevelopmentInventoryError(
      'invalid_inventory',
      `${fieldName} must be a comma-separated list of valid Firebase project IDs.`,
    )
  }
  return new Set(projectIds)
}

export function parseDevelopmentInventory(environment) {
  const projectId = requireValue(environment, 'PEECARE_DEVELOPMENT_PROJECT_ID')
  const allowlist = parseProjectList(
    environment,
    'PEECARE_DEVELOPMENT_PROJECT_ALLOWLIST',
    true,
  )
  const productionDenylist = parseProjectList(
    environment,
    'PEECARE_PRODUCTION_PROJECT_DENYLIST',
    false,
  )
  const firestoreRegion = requireValue(
    environment,
    'PEECARE_DEVELOPMENT_FIRESTORE_REGION',
  )
  const billingOwner = requireValue(environment, 'PEECARE_DEVELOPMENT_BILLING_OWNER')
  const authProvider = requireValue(environment, 'PEECARE_DEVELOPMENT_AUTH_PROVIDER')
  const operatorConfirmation = requireValue(
    environment,
    'PEECARE_DEVELOPMENT_OPERATOR_CONFIRMATION',
  )

  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new DevelopmentInventoryError(
      'invalid_inventory',
      'Development project ID is not a valid Firebase project ID.',
    )
  }
  if (
    projectId.startsWith('demo-') ||
    PRODUCTION_NAME_PATTERN.test(projectId) ||
    productionDenylist.has(projectId)
  ) {
    throw new DevelopmentInventoryError(
      'forbidden_target',
      `Refusing forbidden Firebase target ${projectId}.`,
    )
  }
  if (!allowlist.has(projectId)) {
    throw new DevelopmentInventoryError(
      'non_allowlisted_target',
      `Firebase target ${projectId} is not in the development allowlist.`,
    )
  }
  if (!FIRESTORE_REGION_PATTERN.test(firestoreRegion)) {
    throw new DevelopmentInventoryError(
      'invalid_inventory',
      'Firestore region is not a valid location identifier.',
    )
  }
  if (!ALLOWED_AUTH_PROVIDERS.has(authProvider)) {
    throw new DevelopmentInventoryError(
      'invalid_inventory',
      'Auth provider must be one of password, phone, google.com, or apple.com.',
    )
  }
  if (operatorConfirmation !== REQUIRED_OPERATOR_CONFIRMATION) {
    throw new DevelopmentInventoryError(
      'operator_confirmation_required',
      `Operator confirmation must equal ${REQUIRED_OPERATOR_CONFIRMATION}.`,
    )
  }

  return Object.freeze({
    projectId,
    firestoreRegion,
    billingOwner,
    authProvider,
    operatorConfirmation,
  })
}

export function guardDevelopmentMutation(environment, mutation) {
  if (typeof mutation !== 'function') {
    throw new TypeError('A development mutation callback is required.')
  }
  const inventory = parseDevelopmentInventory(environment)
  return mutation(inventory)
}

export { REQUIRED_OPERATOR_CONFIRMATION }
