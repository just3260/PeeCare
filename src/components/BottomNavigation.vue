<script setup lang="ts">
import { RouterLink } from 'vue-router'

interface FutureNavEntry {
  key: string
  label: string
}

// Devices and notifications are not implemented yet. They render as
// non-interactive, aria-disabled entries so assistive technology announces
// that they cannot be activated — no blank feature pages are created.
const futureEntries: FutureNavEntry[] = [
  { key: 'devices', label: '裝置' },
  { key: 'notifications', label: '通知' },
]
</script>

<template>
  <nav class="bottom-nav" aria-label="主要導覽">
    <RouterLink
      to="/"
      class="bottom-nav__item bottom-nav__item--active"
      aria-label="PeeCare 首頁"
    >
      首頁
    </RouterLink>
    <RouterLink to="/history" class="bottom-nav__item">歷史</RouterLink>
    <RouterLink to="/stats" class="bottom-nav__item">統計</RouterLink>
    <span
      v-for="entry in futureEntries"
      :key="entry.key"
      class="bottom-nav__item bottom-nav__item--disabled"
      role="link"
      aria-disabled="true"
    >
      {{ entry.label }}
    </span>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  justify-content: space-around;
  width: 100%;
  max-width: var(--content-max-width);
  padding: 16px 20px 24px;
  border-radius: 24px 24px 0 0;
  background-color: var(--color-surface);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.05);
}

.bottom-nav__item {
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-disabled);
  text-decoration: none;
}

.bottom-nav__item--active {
  background-color: var(--color-brand-soft);
  color: var(--color-brand);
}

.bottom-nav__item--disabled {
  cursor: not-allowed;
}
</style>
