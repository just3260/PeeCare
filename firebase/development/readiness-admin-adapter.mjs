import { randomBytes } from 'node:crypto'

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const REQUIRED_EVENT_INDEX_FIELDS = Object.freeze([
  'eventType:ASCENDING',
  'effectiveAtMs:DESCENDING',
  'eventId:DESCENDING',
])

function securePassword() {
  return `${randomBytes(32).toString('base64url')}Aa1!`
}

function isDenied(status) {
  return status === 401 || status === 403
}

function adapterHttpError(stage, status) {
  const error = new Error(`Firebase readiness stage failed with HTTP ${status}.`)
  error.code = `${stage}_http_${status}`
  return error
}

export async function createFirebaseAdminReadinessAdapter(projectId) {
  const credential = applicationDefault()
  const appName = `peecare-development-readiness-${projectId}`
  const app =
    getApps().find((candidate) => candidate.name === appName) ??
    initializeApp({ credential, projectId }, appName)
  const auth = getAuth(app)
  const firestore = getFirestore(app)

  async function authorizedJson(url, stage) {
    const accessToken = await credential.getAccessToken()
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken.access_token}`,
        'x-goog-user-project': projectId,
      },
    })
    if (!response.ok) {
      throw adapterHttpError(stage, response.status)
    }
    return response.json()
  }

  async function defaultProviderEnabled(providerId) {
    const accessToken = await credential.getAccessToken()
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/defaultSupportedIdpConfigs/${providerId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken.access_token}`,
          'x-goog-user-project': projectId,
        },
      },
    )
    if (response.status === 404) return false
    if (!response.ok) {
      throw adapterHttpError(`auth_provider_${providerId.replace('.', '_')}`, response.status)
    }
    const config = await response.json()
    return config.enabled === true
  }

  async function signInWithPassword(email, password, apiKey) {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    )
    if (!response.ok) {
      throw adapterHttpError('auth_smoke_sign_in', response.status)
    }
    const payload = await response.json()
    if (typeof payload.idToken !== 'string' || payload.idToken.length === 0) {
      throw new Error('Firebase Auth smoke sign-in returned no ID token.')
    }
    return payload.idToken
  }

  return {
    async readAuthConfiguration() {
      const [config, googleEnabled, appleEnabled] = await Promise.all([
        authorizedJson(
          `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`,
          'auth_config',
        ),
        defaultProviderEnabled('google.com'),
        defaultProviderEnabled('apple.com'),
      ])
      const enabledProviders = []
      if (config.signIn?.email?.enabled === true) enabledProviders.push('password')
      if (config.signIn?.phoneNumber?.enabled === true) enabledProviders.push('phone')
      if (googleEnabled) enabledProviders.push('google.com')
      if (appleEnabled) enabledProviders.push('apple.com')
      return {
        enabledProviders,
        authorizedDomains: Array.isArray(config.authorizedDomains)
          ? config.authorizedDomains.filter((domain) => typeof domain === 'string')
          : [],
      }
    },

    async readRequiredIndexes() {
      const payload = await authorizedJson(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/events/indexes`,
        'firestore_indexes',
      )
      const indexes = Array.isArray(payload.indexes) ? payload.indexes : []
      return indexes
        .map((index) => ({
          collectionGroup: 'events',
          state: index.state,
          fields: Array.isArray(index.fields)
            ? index.fields
                .filter((field) => typeof field.fieldPath === 'string' && field.fieldPath !== '__name__')
                .map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig ?? 'UNKNOWN'}`)
            : [],
        }))
        .filter(
          (index) =>
            index.fields.length === REQUIRED_EVENT_INDEX_FIELDS.length &&
            index.fields.every((field, position) => field === REQUIRED_EVENT_INDEX_FIELDS[position]),
        )
    },

    async runRulesProbes({ marker, ownerUid, nonOwnerUid, deviceId, webApiKey }) {
      const ownerPassword = securePassword()
      const nonOwnerPassword = securePassword()
      const [owner, nonOwner] = await Promise.all([
        auth.updateUser(ownerUid, { password: ownerPassword }),
        auth.updateUser(nonOwnerUid, { password: nonOwnerPassword }),
      ])
      const [ownerToken, nonOwnerToken] = await Promise.all([
        signInWithPassword(owner.email, ownerPassword, webApiKey),
        signInWithPassword(nonOwner.email, nonOwnerPassword, webApiKey),
      ])
      const documentUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/devices/${encodeURIComponent(deviceId)}`
      const probePath = `devices/${deviceId}/readinessWriteProbes/${marker}`
      const probeUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${probePath}`

      const [ownerRead, nonOwnerRead, anonymousRead] = await Promise.all([
        fetch(documentUrl, { headers: { Authorization: `Bearer ${ownerToken}` } }),
        fetch(documentUrl, { headers: { Authorization: `Bearer ${nonOwnerToken}` } }),
        fetch(documentUrl),
      ])
      let clientWrite
      try {
        clientWrite = await fetch(probeUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${ownerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields: { developmentSeedMarker: { stringValue: marker } },
          }),
        })
      } finally {
        await firestore.doc(probePath).delete()
      }

      return {
        ownerReadAllowed: ownerRead.status === 200,
        nonOwnerReadDenied: isDenied(nonOwnerRead.status),
        anonymousReadDenied: isDenied(anonymousRead.status),
        clientWriteDenied: isDenied(clientWrite.status),
      }
    },
  }
}
