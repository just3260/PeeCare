import { describe, expect, it } from 'vitest'

import {
  DeviceOverviewIntegrityError,
  formatTaipeiTimestamp,
  parseDeviceOverview,
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
  latestBatteryEventId: 'evt-battery-1',
  latestBatteryLevelPercent: 75,
  latestBatteryAtMs: 1_700_000_000_200,
  latestBatteryReceivedAtMs: 1_700_000_000_300,
  latestBatteryVoltageMv: 3840,
  lastReportedAtMs: 1_700_000_000_400,
}

describe('parseDeviceOverview', () => {
  it('reads a complete projection and retains original epoch milliseconds', () => {
    const overview = parseDeviceOverview({ deviceId: 'PC-000001', data: completeProjection })

    expect(overview).toEqual({
      urination: {
        eventId: 'evt-urination-1',
        atMs: 1_700_000_000_000,
        receivedAtMs: 1_700_000_000_100,
      },
      battery: {
        eventId: 'evt-battery-1',
        levelPercent: 75,
        atMs: 1_700_000_000_200,
        receivedAtMs: 1_700_000_000_300,
        voltageMv: 3840,
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

    expect(overview).toEqual({ urination: null, battery: null, lastReportedAtMs: null })
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

  it.each([
    ['non-canonical level 30', { ...completeProjection, latestBatteryLevelPercent: 30 }, 'invalid_battery_level'],
    ['negative epoch', { ...completeProjection, latestUrinationAtMs: -1 }, 'invalid_timestamp'],
    ['non-integer voltage', { ...completeProjection, latestBatteryVoltageMv: 3840.5 }, 'invalid_battery_voltage'],
    ['string voltage', { ...completeProjection, latestBatteryVoltageMv: '3840' }, 'invalid_battery_voltage'],
    ['negative lastReported', { ...completeProjection, lastReportedAtMs: -5 }, 'invalid_last_reported'],
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
