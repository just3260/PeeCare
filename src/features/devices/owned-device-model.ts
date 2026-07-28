// Single-owner device model for the Web MVP.
//
// Ownership is expressed by a single scalar `ownerUid` on each device registry
// document. One UID may own many devices; a device never carries more than one
// owner. Sharing, transfer, and multi-owner models are explicitly out of scope
// and will arrive as separate changes.

/** A device the authenticated member owns, projected for read-only Web use. */
export interface OwnedDevice {
  /** Registry document ID; MUST equal the document's own id. */
  readonly deviceId: string
  /** The single owning member UID; a non-empty Firebase UID string. */
  readonly ownerUid: string
  readonly productModel: string
  readonly ingestionStatus: string
}

/** Stable machine codes for structural defects in a device registry document. */
export type OwnedDeviceDataIntegrityCode =
  | 'device_id_mismatch'
  | 'invalid_product_model'
  | 'invalid_ingestion_status'

/**
 * Raised when a device registry document is structurally malformed — a defect
 * that must surface loudly rather than be silently dropped. Ownership that does
 * not match the authenticated member is NOT a data-integrity error; that is an
 * authorization outcome and yields a null model instead.
 */
export class OwnedDeviceDataIntegrityError extends Error {
  readonly code: OwnedDeviceDataIntegrityCode
  readonly documentId: string

  constructor(code: OwnedDeviceDataIntegrityCode, documentId: string, message: string) {
    super(message)
    this.name = 'OwnedDeviceDataIntegrityError'
    this.code = code
    this.documentId = documentId
    // Preserve prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, OwnedDeviceDataIntegrityError.prototype)
  }
}

/**
 * Named inputs for {@link parseOwnedDevice}. A single object keeps the two UID/id
 * strings from being transposed at the call site — passing `authenticatedUid`
 * where `documentId` belongs would otherwise type-check silently.
 */
export interface ParseOwnedDeviceInput {
  /** The Firestore document's own id (the collection key). */
  readonly documentId: string
  /** The raw `snapshot.data()`, untrusted until validated here. */
  readonly data: unknown
  /** The signed-in member UID the read was constrained to. */
  readonly authenticatedUid: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Validate an untrusted device registry document against the single-owner model.
 *
 * Structural defects (a `deviceId` that disagrees with the document id, or a
 * missing/malformed `productModel`/`ingestionStatus`) throw an
 * {@link OwnedDeviceDataIntegrityError} so they can never be silently omitted.
 *
 * Ownership is checked last and is fail-closed: the document yields a model only
 * when `ownerUid` is a non-empty string equal to `authenticatedUid`. A missing,
 * empty, non-string, or mismatched owner returns `null` (unauthorized), so a
 * member can never be handed a device that is not theirs.
 */
export function parseOwnedDevice(input: ParseOwnedDeviceInput): OwnedDevice | null {
  const { documentId, data, authenticatedUid } = input
  const record = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>

  if (record.deviceId !== documentId) {
    throw new OwnedDeviceDataIntegrityError(
      'device_id_mismatch',
      documentId,
      `Device document "${documentId}" declares deviceId "${String(record.deviceId)}".`,
    )
  }
  if (!isNonEmptyString(record.productModel)) {
    throw new OwnedDeviceDataIntegrityError(
      'invalid_product_model',
      documentId,
      `Device document "${documentId}" is missing a valid productModel.`,
    )
  }
  if (!isNonEmptyString(record.ingestionStatus)) {
    throw new OwnedDeviceDataIntegrityError(
      'invalid_ingestion_status',
      documentId,
      `Device document "${documentId}" is missing a valid ingestionStatus.`,
    )
  }

  // Fail-closed ownership gate: only a non-empty owner that matches the caller.
  if (!isNonEmptyString(record.ownerUid) || record.ownerUid !== authenticatedUid) {
    return null
  }

  return {
    deviceId: documentId,
    ownerUid: record.ownerUid,
    productModel: record.productModel,
    ingestionStatus: record.ingestionStatus,
  }
}
