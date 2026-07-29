import {
  createRouter,
  createWebHistory,
  type Router,
  type RouteRecordRaw,
} from 'vue-router'

import HomeView from '@/views/HomeView.vue'
import HistoryView from '@/views/HistoryView.vue'
import StatsView from '@/views/StatsView.vue'
import NotificationsView from '@/views/NotificationsView.vue'
import SettingsView from '@/views/SettingsView.vue'
import SignInView from '@/views/SignInView.vue'
import type { AuthState } from '@/features/auth/session'

// Route-level auth requirement. Protected routes wait for the initial session
// and redirect signed-out visitors to the public sign-in route.
declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
    meta: { requiresAuth: true },
  },
  {
    path: '/history',
    name: 'history',
    component: HistoryView,
    meta: { requiresAuth: true },
  },
  {
    path: '/stats',
    name: 'stats',
    component: StatsView,
    meta: { requiresAuth: true },
  },
  {
    path: '/notifications',
    name: 'notifications',
    component: NotificationsView,
    meta: { requiresAuth: true },
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
    meta: { requiresAuth: true },
  },
  {
    // Device management moved into the settings page; the legacy path now
    // redirects there so existing links and bookmarks keep working.
    path: '/devices',
    redirect: '/settings',
  },
  {
    path: '/sign-in',
    name: 'sign-in',
    component: SignInView,
  },
  {
    // Any unsupported path falls back to the home shell instead of a blank page.
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

/** The slice of the auth store the navigation guard depends on. */
export interface AuthGuardStore {
  readonly state: { readonly value: AuthState }
  whenResolved(): Promise<void>
}

/**
 * Attach the member-session guard: every navigation waits for the first
 * authentication result, protected routes redirect signed-out visitors to
 * `/sign-in` (preserving the attempted path), and a signed-in member visiting
 * `/sign-in` is sent to the home shell.
 */
export function registerAuthGuard(router: Router, store: AuthGuardStore): void {
  router.beforeEach(async (to) => {
    await store.whenResolved()
    const state = store.state.value

    const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)
    if (requiresAuth && state.status !== 'signed-in') {
      return { path: '/sign-in', query: { returnTo: to.fullPath } }
    }

    if (to.name === 'sign-in' && state.status === 'signed-in') {
      return { path: '/' }
    }

    return true
  })
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
