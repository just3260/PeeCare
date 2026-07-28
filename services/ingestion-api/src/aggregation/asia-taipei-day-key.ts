import { AggregationIntegrityError } from './aggregation-error.js';

// Fixed product timezone. An explicit IANA zone expresses the daily contract
// and keeps the key independent of the service host `TZ` or client locale.
const DAY_KEY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei',
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Derives the strict `yyyy-MM-dd` Asia/Taipei calendar date for an instant.
 *
 * Only finite integer epoch milliseconds are valid; anything else is an
 * internal invariant violation rather than a client error.
 */
export function toAsiaTaipeiDayKey(effectiveAtMs: number): string {
  if (!Number.isInteger(effectiveAtMs)) {
    throw new AggregationIntegrityError('day key requires finite integer epoch milliseconds');
  }
  const parts = DAY_KEY_FORMATTER.formatToParts(effectiveAtMs);
  const value = (type: Intl.DateTimeFormatPartTypes): string | undefined => parts.find(part => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  if (year === undefined || month === undefined || day === undefined) {
    throw new AggregationIntegrityError('day key formatting produced incomplete parts');
  }
  return `${year}-${month}-${day}`;
}
