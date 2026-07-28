import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error - reset.mjs is a plain ESM Node script without type declarations.
import { runReset } from './reset.mjs'

const PROJECT_ID = 'demo-peecare'
const AUTH_ORIGIN = 'http://127.0.0.1:9099'
const FIRESTORE_ORIGIN = 'http://127.0.0.1:8085'
const AUTH_ACCOUNTS_URL = `${AUTH_ORIGIN}/emulator/v1/projects/${PROJECT_ID}/accounts`
const AUTH_SIGN_UP_URL =
  `${AUTH_ORIGIN}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`
const AUTH_SIGN_IN_URL =
  `${AUTH_ORIGIN}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`
const FIRESTORE_DOCUMENT_URL =
  `${FIRESTORE_ORIGIN}/v1/projects/${PROJECT_ID}/databases/(default)/documents/resetFixtures/doc-1`

const resetConfig = {
  projectId: PROJECT_ID,
  authHost: '127.0.0.1',
  authPort: 9099,
  firestoreHost: '127.0.0.1',
  firestorePort: 8085,
}

async function createAuthAccount(): Promise<void> {
  const response = await fetch(AUTH_SIGN_UP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'reset-fixture@example.test',
      password: 'fixture-password',
      returnSecureToken: true,
    }),
  })

  expect(response.status).toBe(200)
}

async function createFirestoreDocument(): Promise<void> {
  const response = await fetch(FIRESTORE_DOCUMENT_URL, {
    method: 'PATCH',
    headers: {
      authorization: 'Bearer owner',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        seeded: { booleanValue: true },
      },
    }),
  })

  expect(response.status).toBe(200)
}

function fetchFirestoreDocument(): Promise<Response> {
  return fetch(FIRESTORE_DOCUMENT_URL, {
    headers: { authorization: 'Bearer owner' },
  })
}

async function authAccountExists(): Promise<boolean> {
  const response = await fetch(AUTH_SIGN_IN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'reset-fixture@example.test',
      password: 'fixture-password',
      returnSecureToken: true,
    }),
  })
  return response.ok
}

describe('Emulator reset lifecycle', () => {
  beforeEach(async () => {
    await runReset(resetConfig, { fetch })
  })

  it('removes a real Auth account and Firestore document and remains idempotent', async () => {
    await createAuthAccount()
    await createFirestoreDocument()

    expect(await authAccountExists()).toBe(true)
    expect((await fetchFirestoreDocument()).status).toBe(200)

    await runReset(resetConfig, { fetch })

    expect(await authAccountExists()).toBe(false)
    expect((await fetchFirestoreDocument()).status).toBe(404)

    await expect(runReset(resetConfig, { fetch })).resolves.toEqual({
      auth: AUTH_ACCOUNTS_URL,
      firestore:
        `${FIRESTORE_ORIGIN}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    })
  })
})
