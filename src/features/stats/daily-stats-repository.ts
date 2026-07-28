import {
  getDocs,
  orderBy,
  query,
  where,
  type Firestore,
} from 'firebase/firestore'

import { ownedDeviceDailyStatsRef } from '@/features/devices/owned-device-repository'
import {
  DAILY_STATS_TIME_ZONE,
  parseDailyStatsDocument,
  type DailyStatsDocument,
} from './daily-stats-model'

export { DAILY_STATS_TIME_ZONE }
export const DAILY_STATS_DAY_COUNT = 14

export interface DailyStatsDateRange {
  readonly startDate: string
  readonly endDate: string
}

function taipeiDateParts(now: Date): { year: number, month: number, day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DAILY_STATS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((value) => value.type === type)?.value)
  return { year: part('year'), month: part('month'), day: part('day') }
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/** The inclusive Taiwan-local calendar range ending on the supplied instant's day. */
export function taipeiFourteenDayRange(now = new Date()): DailyStatsDateRange {
  const { year, month, day } = taipeiDateParts(now)
  const end = new Date(Date.UTC(year, month - 1, day))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (DAILY_STATS_DAY_COUNT - 1))
  return { startDate: formatDate(start), endDate: formatDate(end) }
}

/** Reads only the selected device's bounded, date-ascending daily aggregates. */
export async function loadDailyStats(
  firestore: Firestore,
  deviceId: string,
  range = taipeiFourteenDayRange(),
): Promise<readonly DailyStatsDocument[]> {
  if (!deviceId) {
    throw new Error('loadDailyStats requires a non-empty device ID.')
  }
  const { startDate, endDate } = range
  const snapshot = await getDocs(query(
    ownedDeviceDailyStatsRef(firestore, deviceId),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
    orderBy('date', 'asc'),
  ))
  return snapshot.docs.map((document) => parseDailyStatsDocument({
    documentId: document.id,
    data: document.data(),
  }))
}
