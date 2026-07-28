import { buildDailyCountSeries, type DailyCountDocument, type DailyCountPoint } from './daily-series'
import { taipeiFourteenDayRange, type DailyStatsDateRange } from './daily-stats-repository'
import type { DailyStatsSource } from './daily-stats-store'

export interface DailyStatsDocumentLoader {
  loadDocuments(deviceId: string, range: DailyStatsDateRange): Promise<readonly DailyCountDocument[]>
  now?: () => Date
}

/** Turns validated repository documents into a continuous, count-only series. */
export function createDailyStatsSource(options: DailyStatsDocumentLoader): DailyStatsSource {
  return {
    async load(deviceId: string): Promise<readonly DailyCountPoint[]> {
      const range = taipeiFourteenDayRange(options.now?.())
      const documents = await options.loadDocuments(deviceId, range)
      return buildDailyCountSeries(range, documents)
    },
  }
}
