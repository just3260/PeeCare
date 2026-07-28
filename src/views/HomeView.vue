<script setup lang="ts">
import AppHeader from '@/components/AppHeader.vue'
import OverviewPlaceholder from '@/components/OverviewPlaceholder.vue'
import BottomNavigation from '@/components/BottomNavigation.vue'
</script>

<template>
  <AppHeader />
  <main class="home-main">
    <OverviewPlaceholder />
  </main>
  <BottomNavigation />
</template>

<style scoped>
.home-main {
  padding: 0 20px;
}
</style>
