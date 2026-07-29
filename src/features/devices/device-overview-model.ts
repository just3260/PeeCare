// Validated latest-projection model for the member device overview.
//
// The ingestion service maintains "latest" projection fields on each
// `devices/{deviceId}` registry document. The Web client reads them but must
// never trust their shape: a projection is exposed only as a complete, valid
// tuple. A completely absent tuple means "no data yet" (an explicit unknown,
// never zero or an inferred value); a partial or malformed tuple is a
// data-integrity defect that surfaces loudly rather than being shown as ready.
//
// Every timestamp is retained as its original epoch-millisecond number so the
// model stays sortable and testable; presentation formatting to the fixed
// `Asia/Taipei` timezone is a separate, explicit step (see formatTaipeiTimestamp).

import type { UrinationVolumeStatus } from '@/features/history/urination-history-model'

/** The five canonical latest-battery levels the projection may report. */
export const CANONICAL_BATTERY_LEVELS = [0, 25, 50, 75, 100] as const

/** A latest-battery level, constrained to the canonical quantized set. */
export type BatteryLevelPercent = (typeof CANONICAL_BATTERY_LEVELS)[number]

const URINATION_VOLUME_STATUSES: readonly UrinationVolumeStatus[] = ['estimated', 'no_flow', 'out_of_range']

/** A complete latest-urination projection tuple. */
export interface UrinationProjection {
  readonly eventId: string
  /** Event instant, epoch milliseconds (retained verbatim for sort/tests). */
  readonly atMs: number
  /** Ingestion receive instant, epoch milliseconds. */
  readonly receivedAtMs: number
  /** Backend-estimated urine volume in millilitres, or null for legacy projections. */
  readonly estimatedUrineMl: number | null
  /** Volume estimation status, or null when the projection predates volume estimation. */
  readonly estimationStatus: UrinationVolumeStatus | null
}

/** A complete latest-battery projection tuple; voltage is optional. */
export interface BatteryProjection {
  readonly eventId: string
  readonly levelPercent: BatteryLevelPercent
  readonly atMs: number
  readonly receivedAtMs: number
  /** Millivolts from the same latest event, or null when not provided. */
  readonly voltageMv: number | null
}

/**
 * The validated latest overview for one device. Each latest tuple is either a
 * complete projection or `null` (explicit unknown); `lastReportedAtMs` is the
 * device's last report instant, or `null` when unknown.
 */
export interface DeviceOverviewProjection {
  readonly urination: UrinationProjection | null
  readonly battery: BatteryProjection | null
  readonly lastReportedAtMs: number | null
}

/** Stable machine codes for latest-projection data-integrity defects. */
export type DeviceOverviewIntegrityCode =
  | 'partial_urination_tuple'
  | 'invalid_urination_volume'
  | 'partial_battery_tuple'
  | 'invalid_battery_level'
  | 'invalid_battery_voltage'
  | 'invalid_timestamp'
  | 'invalid_last_reported'

/**
 * Raised when a device's latest projection is structurally inconsistent — a
 * partial tuple, an out-of-set battery level, a malformed voltage, or a
 * negative/non-finite epoch. A defect must surface as an error so the overview
 * never renders a contradictory snapshot as a ready card.
 */
export class DeviceOverviewIntegrityError extends Error {
  readonly code: DeviceOverviewIntegrityCode
  readonly deviceId: string

  constructor(code: DeviceOverviewIntegrityCode, deviceId: string, message: string) {
    super(message)
    this.name = 'DeviceOverviewIntegrityError'
    this.code = code
    this.deviceId = deviceId
    Object.setPrototypeOf(this, DeviceOverviewIntegrityError.prototype)
  }
}

/** Named inputs for {@link parseDeviceOverview}. */
export interface ParseDeviceOverviewInput {
  /** The device the snapshot belongs to; used only for error attribution. */
  readonly deviceId: string
  /** Raw `snapshot.data()`, untrusted until validated here. */
  readonly data: unknown
}

/** A value counts as present only when it is neither undefined nor null. */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** A valid epoch millisecond value: a finite, non-negative number. */
function isValidEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isCanonicalBatteryLevel(value: unknown): value is BatteryLevelPercent {
  return (CANONICAL_BATTERY_LEVELS as readonly unknown[]).includes(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isUrinationVolumeStatus(value: unknown): value is UrinationVolumeStatus {
  return (URINATION_VOLUME_STATUSES as readonly unknown[]).includes(value)
}

/**
 * Validate the optional latest-urination volume fields. Both are absent on
 * legacy projections (→ null/null); when either is present the pair must be a
 * coherent, in-set estimate, otherwise the projection is a data-integrity defect.
 */
function parseUrinationVolume(
  deviceId: string,
  ml: unknown,
  status: unknown,
): { estimatedUrineMl: number | null; estimationStatus: UrinationVolumeStatus | null } {
  if (!isPresent(ml) && !isPresent(status)) {
    return { estimatedUrineMl: null, estimationStatus: null }
  }
  if (!isNonNegativeInteger(ml) || !isUrinationVolumeStatus(status) || (status === 'no_flow' && ml !== 0)) {
    throw new DeviceOverviewIntegrityError(
      'invalid_urination_volume',
      deviceId,
      `Device "${deviceId}" has an invalid latest urination volume projection.`,
    )
  }
  return { estimatedUrineMl: ml, estimationStatus: status }
}

function parseUrination(
  deviceId: string,
  record: Record<string, unknown>,
): UrinationProjection | null {
  const eventId = record.latestUrinationEventId
  const atMs = record.latestUrinationAtMs
  const receivedAtMs = record.latestUrinationReceivedAtMs

  const presentCount = [eventId, atMs, receivedAtMs].filter(isPresent).length
  if (presentCount === 0) {
    return null
  }
  if (presentCount < 3 || !isNonEmptyString(eventId)) {
    throw new DeviceOverviewIntegrityError(
      'partial_urination_tuple',
      deviceId,
      `Device "${deviceId}" has an incomplete latest urination projection.`,
    )
  }
  if (!isValidEpoch(atMs) || !isValidEpoch(receivedAtMs)) {
    throw new DeviceOverviewIntegrityError(
      'invalid_timestamp',
      deviceId,
      `Device "${deviceId}" has an invalid latest urination timestamp.`,
    )
  }
  const volume = parseUrinationVolume(
    deviceId,
    record.latestUrinationEstimatedUrineMl,
    record.latestUrinationEstimationStatus,
  )
  return { eventId, atMs, receivedAtMs, ...volume }
}

function parseBattery(deviceId: string, record: Record<string, unknown>): BatteryProjection | null {
  const eventId = record.latestBatteryEventId
  const levelPercent = record.latestBatteryLevelPercent
  const atMs = record.latestBatteryAtMs
  const receivedAtMs = record.latestBatteryReceivedAtMs
  const voltageMv = record.latestBatteryVoltageMv

  const requiredPresentCount = [eventId, levelPercent, atMs, receivedAtMs].filter(isPresent).length
  if (requiredPresentCount === 0) {
    // A voltage without its owning tuple is a partial projection, not "no data".
    if (isPresent(voltageMv)) {
      throw new DeviceOverviewIntegrityError(
        'partial_battery_tuple',
        deviceId,
        `Device "${deviceId}" reports a battery voltage without a battery tuple.`,
      )
    }
    return null
  }
  if (requiredPresentCount < 4 || !isNonEmptyString(eventId)) {
    throw new DeviceOverviewIntegrityError(
      'partial_battery_tuple',
      deviceId,
      `Device "${deviceId}" has an incomplete latest battery projection.`,
    )
  }
  if (!isCanonicalBatteryLevel(levelPercent)) {
    throw new DeviceOverviewIntegrityError(
      'invalid_battery_level',
      deviceId,
      `Device "${deviceId}" reports a non-canonical battery level "${String(levelPercent)}".`,
    )
  }
  if (!isValidEpoch(atMs) || !isValidEpoch(receivedAtMs)) {
    throw new DeviceOverviewIntegrityError(
      'invalid_timestamp',
      deviceId,
      `Device "${deviceId}" has an invalid latest battery timestamp.`,
    )
  }
  // Voltage is optional; when present it must be a non-negative integer.
  let voltage: number | null = null
  if (isPresent(voltageMv)) {
    if (typeof voltageMv !== 'number' || !Number.isInteger(voltageMv) || voltageMv < 0) {
      throw new DeviceOverviewIntegrityError(
        'invalid_battery_voltage',
        deviceId,
        `Device "${deviceId}" reports a malformed battery voltage "${String(voltageMv)}".`,
      )
    }
    voltage = voltageMv
  }
  return { eventId, levelPercent, atMs, receivedAtMs, voltageMv: voltage }
}

function parseLastReported(deviceId: string, record: Record<string, unknown>): number | null {
  const lastReportedAtMs = record.lastReportedAtMs
  if (!isPresent(lastReportedAtMs)) {
    return null
  }
  if (!isValidEpoch(lastReportedAtMs)) {
    throw new DeviceOverviewIntegrityError(
      'invalid_last_reported',
      deviceId,
      `Device "${deviceId}" has an invalid lastReportedAtMs.`,
    )
  }
  return lastReportedAtMs
}

/**
 * Validate an untrusted device snapshot into a {@link DeviceOverviewProjection}.
 *
 * Each latest tuple is validated independently: absent → `null` (unknown),
 * complete-and-valid → a projection, partial/malformed → a
 * {@link DeviceOverviewIntegrityError}. Timestamps are retained as their
 * original epoch milliseconds.
 */
export function parseDeviceOverview(input: ParseDeviceOverviewInput): DeviceOverviewProjection {
  const { deviceId, data } = input
  const record = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>

  return {
    urination: parseUrination(deviceId, record),
    battery: parseBattery(deviceId, record),
    lastReportedAtMs: parseLastReported(deviceId, record),
  }
}

/** The fixed presentation timezone and locale for every overview timestamp. */
const OVERVIEW_TIME_ZONE = 'Asia/Taipei'
const OVERVIEW_LOCALE = 'zh-TW'

const taipeiFormatter = new Intl.DateTimeFormat(OVERVIEW_LOCALE, {
  timeZone: OVERVIEW_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  // h23 avoids locale/runtime-dependent midnight output such as `24:00`.
  hourCycle: 'h23',
})

/**
 * Format an epoch-millisecond instant for display in the fixed `Asia/Taipei`
 * timezone, independent of the host machine's `TZ`. The model retains the raw
 * epoch value; only this presentation step applies the timezone.
 */
export function formatTaipeiTimestamp(epochMs: number): string {
  return taipeiFormatter.format(new Date(epochMs))
}
