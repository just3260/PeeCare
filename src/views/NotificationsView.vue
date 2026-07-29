<script setup lang="ts">
import AppHeader from '@/components/AppHeader.vue'
</script>

<template>
  <AppHeader />
  <main class="notifications-main" aria-label="通知紀錄">
    <section class="notifications-section">
      <p class="notifications-notice" data-test="notifications-empty">尚無通知紀錄</p>
    </section>
  </main>
</template>

<style scoped>
.notifications-main { padding: 0 20px; }
.notifications-section { padding: 20px; border-radius: 20px; background: var(--color-surface); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.03); }
.notifications-notice { color: var(--color-muted); font-size: 14px; }
</style>
