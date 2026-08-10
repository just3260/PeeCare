const APP_MODULE = 'firebase-admin/app'
const AUTH_MODULE = 'firebase-admin/auth'
const FIRESTORE_MODULE = 'firebase-admin/firestore'

function isUserNotFound(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'auth/user-not-found'
  )
}

export async function createFirebaseAdminSeedAdapter(projectId) {
  const [appModule, authModule, firestoreModule] = await Promise.all([
    import(APP_MODULE),
    import(AUTH_MODULE),
    import(FIRESTORE_MODULE),
  ])
  const appName = `peecare-development-seed-${projectId}`
  const app =
    appModule.getApps().find((candidate) => candidate.name === appName) ??
    appModule.initializeApp(
      { credential: appModule.applicationDefault(), projectId },
      appName,
    )
  const auth = authModule.getAuth(app)
  const firestore = firestoreModule.getFirestore(app)

  return {
    async readDocument(path) {
      const snapshot = await firestore.doc(path).get()
      return snapshot.exists ? snapshot.data() : null
    },

    async writeDocument(path, data, options) {
      await firestore.doc(path).set(data, { merge: options.merge })
    },

    async deleteDocumentIfMarked(path, marker) {
      return firestore.runTransaction(async (transaction) => {
        const reference = firestore.doc(path)
        const snapshot = await transaction.get(reference)
        if (!snapshot.exists || snapshot.get('developmentSeedMarker') !== marker) return false
        transaction.delete(reference)
        return true
      })
    },

    async readUser(uid) {
      try {
        const record = await auth.getUser(uid)
        return {
          uid: record.uid,
          email: record.email ?? '',
          emailVerified: record.emailVerified,
          disabled: record.disabled,
          developmentSeedMarker: record.customClaims?.developmentSeedMarker,
          developmentSeedRole: record.customClaims?.developmentSeedRole,
        }
      } catch (error) {
        if (isUserNotFound(error)) return null
        throw error
      }
    },

    async upsertMarkedUser(user) {
      let existingClaims = {}
      try {
        const record = await auth.getUser(user.uid)
        existingClaims = record.customClaims ?? {}
        await auth.updateUser(user.uid, {
          email: user.email,
          emailVerified: user.emailVerified,
          disabled: user.disabled,
        })
      } catch (error) {
        if (!isUserNotFound(error)) throw error
        await auth.createUser({
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified,
          disabled: user.disabled,
        })
      }
      await auth.setCustomUserClaims(user.uid, {
        ...existingClaims,
        developmentSeedMarker: user.developmentSeedMarker,
        developmentSeedRole: user.developmentSeedRole,
      })
    },

    async deleteUserIfMarked(uid, marker) {
      try {
        const record = await auth.getUser(uid)
        if (record.customClaims?.developmentSeedMarker !== marker) return false
        await auth.deleteUser(uid)
        return true
      } catch (error) {
        if (isUserNotFound(error)) return false
        throw error
      }
    },
  }
}
