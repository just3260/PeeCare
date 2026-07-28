import type { InjectionKey } from 'vue'

import type { DailyStatsStore } from './daily-stats-store'

export const DAILY_STATS_STORE_KEY: InjectionKey<DailyStatsStore> = Symbol('daily-stats-store')
