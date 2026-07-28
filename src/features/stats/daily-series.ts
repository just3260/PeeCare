import type { DailyStatsDateRange } from './daily-stats-repository'

export interface DailyCountDocument {
  readonly date: string
  readonly urinationCount: number
}

export interface DailyCountPoint {
  readonly date: string
  readonly urinationCount: number
  readonly synthetic: boolean
}

function datesInRange(range: DailyStatsDateRange): string[] {
  const dates: string[] = []
  const current = new Date(`${range.startDate}T00:00:00.000Z`)
  const end = new Date(`${range.endDate}T00:00:00.000Z`)
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

/** Creates a chart-ready count-only series, preserving whether each day was stored. */
export function buildDailyCountSeries(
  range: DailyStatsDateRange,
  documents: readonly DailyCountDocument[],
): readonly DailyCountPoint[] {
  const documentsByDate = new Map(documents.map((document) => [document.date, document]))
  return datesInRange(range).map((date) => {
    const document = documentsByDate.get(date)
    return document
      ? { date, urinationCount: document.urinationCount, synthetic: false }
      : { date, urinationCount: 0, synthetic: true }
  })
}
