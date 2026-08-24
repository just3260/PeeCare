<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  AUTH_PROVIDER_KEY,
  AuthProviderError,
  createFirebaseAuthProvider,
  type AuthProvider,
} from '@/features/auth/auth-provider'
import {
  clearPendingEmailLink,
  readPendingEmailLink,
  validateEmailLinkEmail,
} from '@/features/auth/email-link-flow'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { resolveSafeReturnPath } from '@/features/auth/return-route'

const provider: AuthProvider = inject(AUTH_PROVIDER_KEY, null) ?? createFirebaseAuthProvider()
const authStore = inject(AUTH_STORE_KEY, null)
const route = useRoute()
const router = useRouter()

type CompletionState = 'checking' | 'needs-email' | 'completing' | 'error'

const state = ref<CompletionState>('checking')
const email = ref('')
const errorMessage = ref<string | null>(null)
let operationPending = false
let componentActive = true
let cancelObserverWait: (() => void) | null = null

function currentLinkHref(): string {
  return new URL(route.fullPath, window.location.origin).toString()
}

function crossDeviceReturnPath(): string {
  const candidate = route.query.returnTo
  return resolveSafeReturnPath(typeof candidate === 'string' ? candidate : null)
}

function waitForObserverSignIn(previousState: object | null): Promise<void> {
  if (authStore === null) {
    return Promise.reject(new Error('auth_store_unavailable'))
  }
  if (
    authStore.state.value !== previousState &&
    authStore.state.value.status === 'signed-in'
  ) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false
    let timeoutId: number | null = null
    let stop = (): void => undefined

    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      stop()
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      if (cancelObserverWait === cancel) cancelObserverWait = null
      action()
    }
    const cancel = (): void => {
      finish(() => reject(new Error('observer_wait_cancelled')))
    }

    cancelObserverWait = cancel
    stop = watch(
      () => authStore.state.value,
      (nextState) => {
        if (nextState !== previousState && nextState.status === 'signed-in') {
          finish(resolve)
        }
      },
      { flush: 'sync' },
    )
    timeoutId = window.setTimeout(() => {
      finish(() => reject(new Error('observer_wait_timeout')))
    }, 10_000)

    if (
      authStore.state.value !== previousState &&
      authStore.state.value.status === 'signed-in'
    ) {
      finish(resolve)
    }
  })
}

function completionFailureMessage(error: unknown): string {
  if (error instanceof AuthProviderError && error.code === 'identity-collision') {
    return '無法完成登入，請使用原本的登入方式。'
  }
  return '登入連結無效或已失效，請重新取得登入連結。'
}

async function complete(emailAddress: string, returnTo: string): Promise<void> {
  if (operationPending) return
  operationPending = true
  state.value = 'completing'
  errorMessage.value = null
  const previousAuthState = authStore?.state.value ?? null

  try {
    try {
      await provider.completeEmailSignInLink({
        email: emailAddress,
        href: currentLinkHref(),
      })
    } catch (error: unknown) {
      clearPendingEmailLink()
      state.value = 'error'
      errorMessage.value = completionFailureMessage(error)
      return
    }

    // The one-time link was accepted. Remove the pending Email immediately;
    // observer publication is a separate gate for exposing the signed-in route.
    clearPendingEmailLink()
    if (!componentActive) return
    try {
      await waitForObserverSignIn(previousAuthState)
    } catch {
      if (!componentActive) return
      state.value = 'error'
      errorMessage.value = '無法確認登入狀態，請返回登入頁重試。'
      return
    }

    if (!componentActive) return
    try {
      await router.push(resolveSafeReturnPath(returnTo))
    } catch {
      state.value = 'error'
      errorMessage.value = '登入已完成，但目前無法前往下一頁，請重新整理。'
    }
  } finally {
    operationPending = false
  }
}

async function handleEmailReentry(): Promise<void> {
  if (operationPending) return

  let normalizedEmail: string
  try {
    normalizedEmail = validateEmailLinkEmail(email.value)
  } catch {
    errorMessage.value = '請輸入有效的電子郵件地址。'
    return
  }

  email.value = ''
  await complete(normalizedEmail, crossDeviceReturnPath())
}

onMounted(() => {
  const pending = readPendingEmailLink()
  if (pending === null) {
    state.value = 'needs-email'
    return
  }

  void complete(pending.email, pending.returnTo)
})

onUnmounted(() => {
  componentActive = false
  cancelObserverWait?.()
})
</script>

<template>
  <main class="email-link-sign-in">
    <h1>完成 Email 登入</h1>

    <p v-if="state === 'checking' || state === 'completing'" role="status">
      正在安全地完成登入…
    </p>

    <form
      v-else-if="state === 'needs-email'"
      class="email-link-sign-in__form"
      data-test="email-reentry"
      @submit.prevent="handleEmailReentry"
    >
      <p>請輸入收到這封登入連結的 Email，以完成登入。</p>
      <label>
        <span>電子郵件</span>
        <input v-model="email" type="email" autocomplete="email" maxlength="254" />
      </label>
      <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
      <button type="submit">完成登入</button>
    </form>

    <p v-else-if="errorMessage" role="alert">{{ errorMessage }}</p>

    <RouterLink data-test="retry-sign-in" to="/sign-in">
      返回登入頁重新取得連結
    </RouterLink>
  </main>
</template>

<style scoped>
.email-link-sign-in {
  max-width: 360px;
  margin: 0 auto;
  padding: 48px 20px;
}

.email-link-sign-in h1 {
  margin-bottom: 20px;
  color: var(--color-brand);
  font-size: 20px;
  text-align: center;
}

.email-link-sign-in__form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.email-link-sign-in__form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.email-link-sign-in input,
.email-link-sign-in button {
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 16px;
}

.email-link-sign-in button {
  border: 0;
  background: var(--color-brand);
  color: var(--color-on-brand, #fff);
}

.email-link-sign-in [role='alert'] {
  color: var(--color-danger, #c0392b);
}
</style>
