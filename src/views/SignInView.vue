<script setup lang="ts">
import { inject, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  AUTH_PROVIDER_KEY,
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
const password = ref('')
const errorMessage = ref<string | null>(null)
const submitting = ref(false)

async function handleSubmit(): Promise<void> {
  errorMessage.value = null
  submitting.value = true
  try {
    await provider.signIn({ email: email.value, password: password.value })
    const returnTo = route.query.returnTo
    const target = resolveSafeReturnPath(typeof returnTo === 'string' ? returnTo : null)
    await router.push(target)
  } catch {
    // Never surface raw provider errors or credentials; show a neutral message.
    errorMessage.value = '登入失敗，請確認帳號密碼後再試一次。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="sign-in">
    <h1 class="sign-in__title">PeeCare 會員登入</h1>
    <form class="sign-in__form" @submit.prevent="handleSubmit">
      <label class="sign-in__field">
        <span>電子郵件</span>
        <input v-model="email" type="email" autocomplete="username" required />
      </label>
      <label class="sign-in__field">
        <span>密碼</span>
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="errorMessage" class="sign-in__error" role="alert">{{ errorMessage }}</p>
      <button class="sign-in__submit" type="submit" :disabled="submitting">登入</button>
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

.sign-in__submit {
  padding: 12px 16px;
  border: none;
  border-radius: 20px;
  background-color: var(--color-brand);
  color: var(--color-on-brand, #fff);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.sign-in__submit:disabled {
  opacity: 0.6;
  cursor: progress;
}
</style>
