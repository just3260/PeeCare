<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import BottomNavigation from '@/components/BottomNavigation.vue'
import { AUTH_STORE_KEY } from '@/features/auth/auth-store-key'

// Injected so the shell drives a single auth lifecycle in production while tests
// can mount App without any Firebase dependency (defaults to null).
const authStore = inject(AUTH_STORE_KEY, null)
const route = useRoute()

onMounted(() => authStore?.mount())
onUnmounted(() => authStore?.dispose())

const showsBottomNavigation = computed(() => route.matched.some((record) => record.meta.requiresAuth))
</script>

<template>
  <div class="peecare-app">
    <RouterView />
    <BottomNavigation v-if="showsBottomNavigation" />
  </div>
</template>

<style scoped>
.peecare-app {
  max-width: var(--content-max-width);
  min-height: 100vh;
  margin: 0 auto;
  /* Room for the fixed bottom navigation. */
  padding-bottom: 96px;
  background-color: var(--color-bg);
}
</style>
