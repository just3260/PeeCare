import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import HomeView from '@/views/HomeView.vue'

// Bootstrap navigation boundary: only the home route exists today. Later
// authentication, history, and device changes add their own route records
// without rewriting App.vue.
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
  },
  {
    // Any unsupported path falls back to the home shell instead of a blank page.
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
