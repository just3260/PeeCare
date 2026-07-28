<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'

import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'
import { AUTH_PROVIDER_KEY, type AuthProvider } from '@/features/auth/auth-provider'
import { SIGN_IN_PATH } from '@/features/auth/return-route'

// Injected so the shell drives a single auth lifecycle in production while tests
// can mount App without any Firebase dependency (both default to null).
const authStore = inject(AUTH_STORE_KEY, null)
const authProvider = inject<AuthProvider | null>(AUTH_PROVIDER_KEY, null)
const router = useRouter()

onMounted(() => authStore?.mount())
onUnmounted(() => authStore?.dispose())

const isSignedIn = computed(() => authStore?.state.value.status === 'signed-in')

async function handleSignOut(): Promise<void> {
  // End the session first; the observer then tears down protected subscriptions.
  await authProvider?.signOut()
  await router.push(SIGN_IN_PATH)
}
</script>

<template>
  <div class="peecare-app">
    <button
      v-if="isSignedIn"
      type="button"
      class="peecare-app__sign-out"
      data-test="sign-out"
      @click="handleSignOut"
    >
      登出
    </button>
    <RouterView />
  </div>
</template>

<style scoped>
.peecare-app {
  position: relative;
  max-width: var(--content-max-width);
  min-height: 100vh;
  margin: 0 auto;
  /* Room for the fixed bottom navigation. */
  padding-bottom: 96px;
  background-color: var(--color-bg);
}

.peecare-app__sign-out {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 1;
  padding: 6px 14px;
  border: 1px solid var(--color-border, #d0d0d0);
  border-radius: 16px;
  background-color: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
}
</style>
