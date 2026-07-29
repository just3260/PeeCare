<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()

function isActive(name: string): boolean {
  return route.name === name
}
</script>

<template>
  <nav class="bottom-nav" aria-label="主要導覽">
    <RouterLink
      to="/history"
      class="bottom-nav__item"
      :class="{ 'bottom-nav__item--active': isActive('history') }"
      :aria-current="isActive('history') ? 'page' : undefined"
      aria-label="歷史紀錄"
    >
      <svg class="bottom-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 4v4h4" />
        <path d="M12 8v4l3 2" />
      </svg>
      <span class="bottom-nav__label">歷史</span>
    </RouterLink>

    <RouterLink
      to="/stats"
      class="bottom-nav__item"
      :class="{ 'bottom-nav__item--active': isActive('stats') }"
      :aria-current="isActive('stats') ? 'page' : undefined"
      aria-label="統計數據"
    >
      <svg class="bottom-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 20V10" />
        <path d="M10 20V4" />
        <path d="M16 20v-7" />
        <path d="M22 20H2" />
      </svg>
      <span class="bottom-nav__label">統計</span>
    </RouterLink>

    <RouterLink
      to="/"
      class="bottom-nav__item"
      :class="{ 'bottom-nav__item--active': isActive('home') }"
      :aria-current="isActive('home') ? 'page' : undefined"
      aria-label="PeeCare 首頁"
    >
      <svg class="bottom-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V20h14V9.5" />
        <path d="M10 20v-5h4v5" />
      </svg>
      <span class="bottom-nav__label">首頁</span>
    </RouterLink>

    <RouterLink
      to="/notifications"
      class="bottom-nav__item"
      :class="{ 'bottom-nav__item--active': isActive('notifications') }"
      :aria-current="isActive('notifications') ? 'page' : undefined"
      aria-label="通知"
    >
      <svg class="bottom-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.5 21a1.7 1.7 0 0 1-3 0" />
      </svg>
      <span class="bottom-nav__label">通知</span>
    </RouterLink>

    <RouterLink
      to="/settings"
      class="bottom-nav__item"
      :class="{ 'bottom-nav__item--active': isActive('settings') }"
      :aria-current="isActive('settings') ? 'page' : undefined"
      aria-label="設定"
    >
      <svg class="bottom-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
      <span class="bottom-nav__label">設定</span>
    </RouterLink>
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
  align-items: flex-end;
  width: 100%;
  max-width: var(--content-max-width);
  padding: 12px 16px 20px;
  border-radius: 24px 24px 0 0;
  background-color: var(--color-surface);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.05);
}

.bottom-nav__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
  padding: 6px 4px;
  color: var(--color-disabled);
  text-decoration: none;
}

.bottom-nav__icon {
  width: 24px;
  height: 24px;
}

.bottom-nav__label {
  font-size: 12px;
  font-weight: 500;
}

.bottom-nav__item--active {
  color: var(--color-brand);
}
</style>
