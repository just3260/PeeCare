<script setup lang="ts">
import { inject, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  AUTH_PROVIDER_KEY,
  AuthProviderError,
  createFirebaseAuthProvider,
  type AuthProvider,
} from '@/features/auth/auth-provider'
import { resolveSafeReturnPath } from '@/features/auth/return-route'

// Provider is injected so the view stays provider-neutral; the local Firebase
// provider is only the default and touches Firebase lazily.
const provider: AuthProvider = inject(AUTH_PROVIDER_KEY, null) ?? createFirebaseAuthProvider()
const route = useRoute()
const router = useRouter()

const email = ref('')
const errorMessage = ref<string | null>(null)
const emailLinkSentMessage = ref<string | null>(null)
const googleSubmitting = ref(false)
const emailSubmitting = ref(false)

function safeReturnPath(): string {
  const returnTo = route.query.returnTo
  return resolveSafeReturnPath(typeof returnTo === 'string' ? returnTo : null)
}

function googleFailureMessage(error: unknown): string {
  if (error instanceof AuthProviderError) {
    if (error.code === 'identity-collision') {
      return '無法完成登入，請使用原本的登入方式。'
    }
    if (error.code === 'google-popup-unavailable') {
      return '無法開啟 Google 登入視窗，請再試一次。'
    }
  }
  return 'Google 登入失敗，請稍後再試。'
}

async function handleGoogleSignIn(): Promise<void> {
  if (googleSubmitting.value || emailSubmitting.value) return

  errorMessage.value = null
  emailLinkSentMessage.value = null
  googleSubmitting.value = true
  try {
    try {
      await provider.signInWithGoogle()
    } catch (error: unknown) {
      errorMessage.value = googleFailureMessage(error)
      return
    }

    try {
      await router.push(safeReturnPath())
    } catch {
      // Authentication already succeeded; do not misreport a routing failure
      // as a Firebase failure or expose router internals.
      errorMessage.value = '登入已完成，但目前無法前往下一頁，請重新整理。'
    }
  } finally {
    googleSubmitting.value = false
  }
}

async function handleEmailLinkRequest(): Promise<void> {
  if (googleSubmitting.value || emailSubmitting.value) return

  errorMessage.value = null
  emailLinkSentMessage.value = null

  const normalizedEmail = email.value.trim()
  if (normalizedEmail.length === 0 || normalizedEmail.length > 254) {
    errorMessage.value = '請輸入有效的電子郵件地址。'
    return
  }

  emailSubmitting.value = true
  try {
    await provider.sendEmailSignInLink({
      email: normalizedEmail,
      returnTo: safeReturnPath(),
    })
    emailLinkSentMessage.value =
      '如果這個 Email 可以登入，我們已寄出登入連結，請前往信箱查看。'
  } catch {
    // Do not reveal account existence, provider details, or raw Firebase errors.
    errorMessage.value = '無法寄出登入連結，請稍後再試。'
  } finally {
    emailSubmitting.value = false
  }
}
</script>

<template>
  <main class="sign-in">
    <h1 class="sign-in__title">PeeCare 會員登入</h1>
    <button
      class="sign-in__google"
      data-test="google-sign-in"
      type="button"
      :disabled="googleSubmitting || emailSubmitting"
      @click="handleGoogleSignIn"
    >
      使用 Google 繼續
    </button>

    <p class="sign-in__separator" aria-hidden="true"><span>或</span></p>

    <form class="sign-in__form" @submit.prevent="handleEmailLinkRequest">
      <label class="sign-in__field">
        <span>電子郵件</span>
        <input
          v-model="email"
          type="email"
          autocomplete="email"
          maxlength="254"
          :disabled="googleSubmitting || emailSubmitting"
        />
      </label>
      <p v-if="errorMessage" class="sign-in__error" role="alert">{{ errorMessage }}</p>
      <p
        v-if="emailLinkSentMessage"
        class="sign-in__confirmation"
        data-test="email-link-sent"
        role="status"
      >
        {{ emailLinkSentMessage }}
      </p>
      <button
        class="sign-in__submit"
        data-test="send-email-link"
        type="submit"
        :disabled="googleSubmitting || emailSubmitting"
      >
        寄送 Email 登入連結
      </button>
    </form>
  </main>
</template>

<style scoped>
.sign-in {
  max-width: 360px;
  margin: 0 auto;
  padding: 48px 20px;
}

.sign-in__title {
  margin-bottom: 24px;
  font-size: 20px;
  font-weight: 600;
  color: var(--color-brand);
  text-align: center;
}

.sign-in__form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sign-in__google,
.sign-in__submit {
  width: 100%;
  padding: 12px 16px;
  border-radius: 20px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.sign-in__google {
  border: 1px solid var(--color-border, #d0d0d0);
  background: var(--color-surface, #fff);
  color: var(--color-text);
}

.sign-in__separator {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0;
  color: var(--color-text-muted, #777);
  font-size: 13px;
}

.sign-in__separator::before,
.sign-in__separator::after {
  flex: 1;
  height: 1px;
  background: var(--color-border, #d0d0d0);
  content: '';
}

.sign-in__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--color-text);
}

.sign-in__field input {
  padding: 10px 12px;
  border: 1px solid var(--color-border, #d0d0d0);
  border-radius: 12px;
  font-size: 16px;
}

.sign-in__error {
  margin: 0;
  font-size: 14px;
  color: var(--color-danger, #c0392b);
}

.sign-in__confirmation {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-brand);
}

.sign-in__submit {
  border: none;
  background-color: var(--color-brand);
  color: var(--color-on-brand, #fff);
}

.sign-in__google:disabled,
.sign-in__submit:disabled {
  opacity: 0.6;
  cursor: progress;
}
</style>
