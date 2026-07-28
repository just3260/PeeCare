<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="peecare-app">
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
</style>
