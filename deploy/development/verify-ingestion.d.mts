import type { IngestionManifest } from './deploy-ingestion.mjs'

export type IngestionVerificationErrorCode =
  | 'exact_revision_required'
  | 'target_mismatch'
  | 'invalid_secret_reference'
  | 'revision_mismatch'
  | 'rollback_target_invalid'
  | 'smoke_failed'
  | 'cloud_inspection_failed'

export class IngestionVerificationError extends Error {
  readonly code: IngestionVerificationErrorCode
}

export interface InspectedIngestionRevision {
  readonly ready: boolean
  readonly serving: boolean
  readonly projectId: string
  readonly region: string
  readonly service: string
  readonly revision: string
  readonly image: string
  readonly runtimeIdentity: string
  readonly serviceUrl: string
}

export interface IngestionVerificationAdapter {
  inspectRevision(input: {
    projectId: string
    region: string
    service: string
    revision: string
  }): Promise<InspectedIngestionRevision>
  accessSecret(reference: string): Promise<string>
  request(input: {
    url: string
    method: string
    headers?: Readonly<Record<string, string>>
    body?: unknown
  }): Promise<{ status: number; body: any }>
  readEvent(input: {
    projectId: string
    deviceId: string
    eventId: string
  }): Promise<{
    projectId: string
    path: string
    data: Record<string, unknown>
  } | null>
  readSmokeState(input: {
    projectId: string
    deviceId: string
    eventIds: readonly string[]
    dayKey: string
  }): Promise<{
    projectId: string
    device: Record<string, unknown> | null
    events: Record<string, Record<string, unknown> | null>
    daily: Record<string, unknown> | null
  }>
}

export interface IngestionVerificationResult {
  readonly status: 'healthy'
  readonly projectId: 'petcare-c7483'
  readonly region: 'asia-east1'
  readonly service: 'peecare-ingestion-development'
  readonly revision: string
  readonly imageDigest: string
  readonly runtimeIdentity: string
  readonly eventId: 'PC-DEV-0001:smoke-urination-1'
  readonly priorHealthyRevision?: {
    readonly revision: string
    readonly imageDigest: string
  }
  readonly checks: {
    readonly health: 200
    readonly unauthenticated: 401
    readonly authenticated: 201
    readonly firestore: 'verified'
    readonly durableEvents: {
      readonly urination: readonly [201, 200]
      readonly battery: readonly [201, 200]
      readonly immutableEventCount: 2
      readonly urinationCountDelta: 1
      readonly duplicateWrites: 0
    }
  }
}

export function runIngestionVerification(options: {
  environment: NodeJS.ProcessEnv
  args: readonly string[]
  manifest: IngestionManifest
  adapter: IngestionVerificationAdapter
  priorRelease?: {
    status: 'healthy'
    projectId: string
    region: string
    service: string
    revision: string
    imageDigest: string
  }
  now?: () => number
  write: (line: string) => void
}): Promise<IngestionVerificationResult>

export function createCliVerificationAdapter(): IngestionVerificationAdapter

export function runIngestionRollback(options: {
  args: readonly string[]
  manifest: IngestionManifest
  releaseRecord: {
    status: 'healthy'
    projectId: string
    region: string
    service: string
    revision: string
    priorHealthyRevision: {
      revision: string
      imageDigest: string
    } | null
  }
  inspectRevision: IngestionVerificationAdapter['inspectRevision']
  executeTrafficMutation: (command: string, args: readonly string[]) => unknown
  write: (line: string) => void
}): Promise<{
  status: 'ready'
  dryRun: true
  projectId: string
  region: string
  service: string
  currentRevision: string
  targetRevision: string
  imageDigest: string
  command: { executable: 'gcloud'; args: readonly string[] }
}>
