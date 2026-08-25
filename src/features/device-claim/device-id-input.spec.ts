import { describe, expect, it } from 'vitest'

import {
  normalizeManualDeviceId,
  parseDeviceConnectQuery,
  parseDeviceIdQuery,
} from './device-id-input'

describe('device Claim identifier input', () => {
  it.each([
    ['68E274BD2A58', '68E274BD2A58'],
    [' 68e274bd2a58 ', '68E274BD2A58'],
    ['68E274BD2A5', null],
    ['68E274BD2A5G', null],
  ])('normalizes manual input %j to %j', (input, expected) => {
    expect(normalizeManualDeviceId(input)).toBe(expected)
  })

  it('accepts exactly one canonical QR query value', () => {
    expect(parseDeviceIdQuery('68E274BD2A58')).toEqual({
      status: 'selected',
      deviceId: '68E274BD2A58',
    })
  })

  it.each([
    { value: ['68E274BD2A58', '001122334455'], reason: 'duplicate' },
    { value: '68e274bd2a58', reason: 'invalid' },
    { value: '68E274BD2A5G', reason: 'invalid' },
  ])('rejects unsafe QR query input $value', ({ value, reason }) => {
    expect(parseDeviceIdQuery(value)).toEqual({ status: 'rejected', reason })
  })

  it('treats an absent QR query as manual-entry mode', () => {
    expect(parseDeviceIdQuery(undefined)).toEqual({ status: 'absent' })
  })

  it.each(['code', 'token', 'uid'])(
    'rejects a QR query carrying forbidden %s data',
    (key) => {
      expect(parseDeviceConnectQuery({
        deviceId: '68E274BD2A58',
        [key]: 'must-not-enter-the-flow',
      })).toEqual({ status: 'rejected', reason: 'unsupported' })
    },
  )
})
