<script setup lang="ts"></script>

<template>
  <header class="app-header">
    <div class="app-header__brand">
      <span class="app-header__logo" aria-hidden="true">🐾</span>
      <span class="app-header__titles">
        <span class="app-header__name">PeeCare</span>
        <span class="app-header__tagline">寵物尿量監測</span>
      </span>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
}

.app-header__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-header__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--color-brand-strong);
  font-size: 20px;
}

.app-header__titles {
  display: flex;
  flex-direction: column;
}

.app-header__name {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-ink);
}

.app-header__tagline {
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-muted);
}
</style>
