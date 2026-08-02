import { describe, expect, it } from 'vitest'

import {
  DeviceOverviewIntegrityError,
  formatTaipeiTimestamp,
  parseDeviceOverview,
  resolveTodayTotals,
} from './device-overview-model'

// A complete, valid latest projection as ingestion leaves it: both tuples plus
// lastReportedAtMs. Individual tests strip or corrupt fields from this base.
const completeProjection = {
  deviceId: 'PC-000001',
  ownerUid: 'member-001',
  productModel: 'pc-mini',
  ingestionStatus: 'enabled',
  latestUrinationEventId: 'evt-urination-1',
  latestUrinationAtMs: 1_700_000_000_000,
  latestUrinationReceivedAtMs: 1_700_000_000_100,
  latestUrinationEstimatedUrineMl: 200,
  latestUrinationEstimationStatus: 'estimated',
  latestBatteryEventId: 'evt-battery-1',
  latestBatteryLevelPercent: 75,
  latestBatteryAtMs: 1_700_000_000_200,
  latestBatteryReceivedAtMs: 1_700_000_000_300,
  latestBatteryVoltageMv: 3840,
  lastReportedAtMs: 1_700_000_000_400,
  todayDate: '2026-07-28',
  todayUrinationCount: 3,
  todayEstimatedUrineTotalMl: 550,
}

describe('parseDeviceOverview', () => {
  it('reads a complete projection and retains original epoch milliseconds', () => {
    const overview = parseDeviceOverview({ deviceId: 'PC-000001', data: completeProjection })

    expect(overview).toEqual({
      urination: {
        eventId: 'evt-urination-1',
        atMs: 1_700_000_000_000,
        receivedAtMs: 1_700_000_000_100,
        estimatedUrineMl: 200,
        estimationStatus: 'estimated',
      },
      battery: {
        eventId: 'evt-battery-1',
        levelPercent: 75,
        atMs: 1_700_000_000_200,
        receivedAtMs: 1_700_000_000_300,
        voltageMv: 3840,
      },
      today: {
        date: '2026-07-28',
        urinationCount: 3,
        estimatedUrineTotalMl: 550,
      },
      lastReportedAtMs: 1_700_000_000_400,
    })
  })

  // Spec example: a complete projection with level 75 and voltage 3840 exposes
  // both values from that same latest event.
  it('exposes a complete latest battery snapshot with its voltage', () => {
    const overview = parseDeviceOverview({ deviceId: 'PC-000001', data: completeProjection })

    expect(overview.battery?.levelPercent).toBe(75)
    expect(overview.battery?.voltageMv).toBe(3840)
  })

  it('treats a completely absent projection as missing data, not an error', () => {
    const overview = parseDeviceOverview({
      deviceId: 'PC-000001',
      data: {
        deviceId: 'PC-000001',
        ownerUid: 'member-001',
        productModel: 'pc-mini',
        ingestionStatus: 'enabled',
      },
    })

    expect(overview).toEqual({ urination: null, battery: null, today: null, lastReportedAtMs: null })
  })

  // Spec example: a device carrying none of the three today fields has simply
  // never stored a urination event — missing data, never a zero.
  it('treats an absent today tuple as missing data', () => {
    const { todayDate: _d, todayUrinationCount: _c, todayEstimatedUrineTotalMl: _t, ...noToday } =
      completeProjection

    const overview = parseDeviceOverview({ deviceId: 'PC-000001', data: noToday })

    expect(overview.today).toBeNull()
  })

  // Spec example: a count without its owning date and total is a partial tuple.
  it('rejects a partial today tuple (count without date or total)', () => {
    const partial = {
      deviceId: 'PC-000001',
      ownerUid: 'member-001',
      productModel: 'pc-mini',
      ingestionStatus: 'enabled',
      todayUrinationCount: 3,
    }

    try {
      parseDeviceOverview({ deviceId: 'PC-000001', data: partial })
      expect.unreachable('expected a data-integrity error')
    } catch (error) {
      expect(error).toBeInstanceOf(DeviceOverviewIntegrityError)
      expect((error as DeviceOverviewIntegrityError).code).toBe('partial_today_tuple')
    }
  })

  it.each([
    ['missing today total', { ...completeProjection, todayEstimatedUrineTotalMl: undefined }, 'partial_today_tuple'],
    ['negative today count', { ...completeProjection, todayUrinationCount: -1 }, 'invalid_today_totals'],
    ['fractional today count', { ...completeProjection, todayUrinationCount: 2.5 }, 'invalid_today_totals'],
    ['non-numeric today total', { ...completeProjection, todayEstimatedUrineTotalMl: '550' }, 'invalid_today_totals'],
    ['negative today total', { ...completeProjection, todayEstimatedUrineTotalMl: -5 }, 'invalid_today_totals'],
    ['unpadded today date', { ...completeProjection, todayDate: '2026-7-28' }, 'invalid_today_totals'],
  ])('raises a typed integrity error for %s', (_label, data, expectedCode) => {
    try {
      parseDeviceOverview({ deviceId: 'PC-000001', data })
      expect.unreachable('expected a data-integrity error')
    } catch (error) {
      expect(error).toBeInstanceOf(DeviceOverviewIntegrityError)
      expect((error as DeviceOverviewIntegrityError).code).toBe(expectedCode)
      expect((error as DeviceOverviewIntegrityError).deviceId).toBe('PC-000001')
    }
  })

  it('accepts an optional battery tuple with no voltage', () => {
    const { latestBatteryVoltageMv: _omitted, ...noVoltage } = completeProjection

    const overview = parseDeviceOverview({ deviceId: 'PC-000001', data: noVoltage })

    expect(overview.battery?.levelPercent).toBe(75)
    expect(overview.battery?.voltageMv).toBeNull()
  })

  // Spec example: level 25 present but the eventId and atMs are missing — a
  // partial tuple must raise a data-integrity error, never a ready card.
  it('rejects a partial battery tuple (level without id or timestamps)', () => {
    const partial = {
      deviceId: 'PC-000001',
      ownerUid: 'member-001',
      productModel: 'pc-mini',
      ingestionStatus: 'enabled',
      latestBatteryLevelPercent: 25,
    }

    expect(() => parseDeviceOverview({ deviceId: 'PC-000001', data: partial })).toThrow(
      DeviceOverviewIntegrityError,
    )
  })

  it('rejects a partial urination tuple (missing receivedAtMs)', () => {
    const { latestUrinationReceivedAtMs: _dropped, ...partial } = completeProjection

    expect(() => parseDeviceOverview({ deviceId: 'PC-000001', data: partial })).toThrow(
      DeviceOverviewIntegrityError,
    )
  })

  it('reads a legacy urination tuple without a stored volume as null volume', () => {
    const { latestUrinationEstimatedUrineMl: _ml, latestUrinationEstimationStatus: _status, ...legacy } =
      completeProjection

    const overview = parseDeviceOverview({ deviceId: 'PC-000001', data: legacy })

    expect(overview.urination).toMatchObject({ eventId: 'evt-urination-1', estimatedUrineMl: null, estimationStatus: null })
  })

  it.each([
    ['non-canonical level 30', { ...completeProjection, latestBatteryLevelPercent: 30 }, 'invalid_battery_level'],
    ['negative epoch', { ...completeProjection, latestUrinationAtMs: -1 }, 'invalid_timestamp'],
    ['non-integer voltage', { ...completeProjection, latestBatteryVoltageMv: 3840.5 }, 'invalid_battery_voltage'],
    ['string voltage', { ...completeProjection, latestBatteryVoltageMv: '3840' }, 'invalid_battery_voltage'],
    ['negative lastReported', { ...completeProjection, lastReportedAtMs: -5 }, 'invalid_last_reported'],
    ['negative urine volume', { ...completeProjection, latestUrinationEstimatedUrineMl: -1 }, 'invalid_urination_volume'],
    ['unknown volume status', { ...completeProjection, latestUrinationEstimationStatus: 'pending_calibration' }, 'invalid_urination_volume'],
    ['incoherent no_flow volume', { ...completeProjection, latestUrinationEstimationStatus: 'no_flow' }, 'invalid_urination_volume'],
  ])('raises a typed integrity error for %s', (_label, data, expectedCode) => {
    try {
      parseDeviceOverview({ deviceId: 'PC-000001', data })
      expect.unreachable('expected a data-integrity error')
    } catch (error) {
      expect(error).toBeInstanceOf(DeviceOverviewIntegrityError)
      expect((error as DeviceOverviewIntegrityError).code).toBe(expectedCode)
      expect((error as DeviceOverviewIntegrityError).deviceId).toBe('PC-000001')
    }
  })
})

// Staleness is decided by the reader, because ingestion is never woken up by the
// absence of events and therefore cannot zero a projection at midnight itself.
describe('resolveTodayTotals', () => {
  const projection = { date: '2026-07-28', urinationCount: 3, estimatedUrineTotalMl: 550 }

  // Spec example: 2026-07-28T15:59:59.999Z is still 2026-07-28 in Asia/Taipei.
  it('uses the projected totals while the instant is on the projected day', () => {
    const totals = resolveTodayTotals(projection, Date.parse('2026-07-28T15:59:59.999Z'))

    expect(totals).toEqual({ urinationCount: 3, estimatedUrineTotalMl: 550 })
  })

  // Spec example: 2026-07-28T16:00:00.000Z has already rolled over to 2026-07-29
  // in Asia/Taipei, so the projection describes yesterday.
  it('reads a projection left on an earlier day as zero for today', () => {
    const totals = resolveTodayTotals(projection, Date.parse('2026-07-28T16:00:00.000Z'))

    expect(totals).toEqual({ urinationCount: 0, estimatedUrineTotalMl: 0 })
  })

  it('keeps a missing tuple unknown instead of reporting zero', () => {
    expect(resolveTodayTotals(null, Date.parse('2026-07-28T16:00:00.000Z'))).toBeNull()
  })

  it('uses the projected totals from the first instant of the projected Taipei day', () => {
    const totals = resolveTodayTotals(projection, Date.parse('2026-07-27T16:00:00.000Z'))

    expect(totals).toEqual({ urinationCount: 3, estimatedUrineTotalMl: 550 })
  })
})

// Presentation always uses the fixed Asia/Taipei timezone regardless of the host
// TZ. Because the formatter pins timeZone explicitly, the same epoch instant maps
// to the same Taipei wall-clock date on any machine.
describe('formatTaipeiTimestamp', () => {
  it('maps a UTC midnight-boundary instant to the next Taipei day', () => {
    // 2026-07-27T16:00:00.000Z is 2026-07-28 00:00 in Asia/Taipei (UTC+8).
    const formatted = formatTaipeiTimestamp(Date.parse('2026-07-27T16:00:00.000Z'))

    expect(formatted).toContain('2026/07/28')
    expect(formatted).toContain('00:00')
  })

  it('keeps an instant just before the boundary on the prior Taipei day', () => {
    const formatted = formatTaipeiTimestamp(Date.parse('2026-07-27T15:59:59.999Z'))

    expect(formatted).toContain('2026/07/27')
    expect(formatted).toContain('23:59')
  })

  it('formats from the raw epoch, not the host local time', () => {
    const epochMs = Date.parse('2026-07-27T16:00:00.000Z')

    // Formatting the same epoch twice is stable and host-TZ independent.
    expect(formatTaipeiTimestamp(epochMs)).toBe(formatTaipeiTimestamp(epochMs))
    expect(formatTaipeiTimestamp(epochMs)).toContain('2026/07/28')
  })
})
