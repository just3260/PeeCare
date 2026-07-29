/**
 * Calibration for the pump-time → urine-volume estimate. The peristaltic pump
 * moves roughly PUMP_ML_PER_UNIT millilitres of liquid per PUMP_UNIT_MS of *net*
 * pump time, where net time is the pump duration minus the flush duration that
 * pushes clean water rather than urine.
 *
 * Base formula: estimatedUrineMl = (pumpDurationMs - flushDurationMs) / 100 * 10
 */
const PUMP_UNIT_MS = 100
const PUMP_ML_PER_UNIT = 10

/**
 * Upper plausibility bound, in millilitres, for a single urination event. A
 * larger estimate almost certainly indicates a stuck pump or a sensor fault, so
 * it is surfaced for review instead of being trusted silently.
 */
const MAX_PLAUSIBLE_URINE_ML = 2000

/**
 * - `estimated`   — a plausible, positive volume derived from the pump window.
 * - `no_flow`     — the pump did not run longer than the flush; no measurable urine.
 * - `out_of_range`— a positive but implausibly large volume, kept for audit but flagged.
 */
export type UrineVolumeStatus = 'estimated' | 'no_flow' | 'out_of_range'

export interface UrineVolumeEstimate {
  readonly estimatedUrineMl: number
  readonly estimationStatus: UrineVolumeStatus
}

/**
 * Estimate the urinated liquid volume from raw pump/flush durations.
 *
 * Pure and total: every input maps to an explicit, validated result. A
 * non-positive (or non-finite) net window becomes a zero `no_flow` reading, and
 * an implausibly large window keeps its value but is flagged `out_of_range`.
 */
export function estimateUrineVolume(
  flushDurationMs: number,
  pumpDurationMs: number,
): UrineVolumeEstimate {
  const netPumpMs = pumpDurationMs - flushDurationMs
  if (!Number.isFinite(netPumpMs) || netPumpMs <= 0) {
    return { estimatedUrineMl: 0, estimationStatus: 'no_flow' }
  }

  const estimatedUrineMl = Math.round((netPumpMs / PUMP_UNIT_MS) * PUMP_ML_PER_UNIT)
  if (estimatedUrineMl > MAX_PLAUSIBLE_URINE_ML) {
    return { estimatedUrineMl, estimationStatus: 'out_of_range' }
  }

  return { estimatedUrineMl, estimationStatus: 'estimated' }
}
