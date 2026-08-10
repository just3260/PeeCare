import type { MemberManifest } from './deploy-member.mjs'

export type MemberVerificationErrorCode =
  | 'explicit_revision_required'
  | 'target_mismatch'
  | 'invalid_revision'
  | 'immutable_image_required'
  | 'revision_mismatch'
  | 'invalid_verified_origin'
  | 'smoke_failed'
  | 'unverified_release'
  | 'explicit_mode_required'
  | 'web_build_failed'
  | 'rollback_target_invalid'
  | 'smoke_config_missing'
  | 'smoke_config_invalid'
  | 'smoke_auth_failed'
  | 'cloud_inspection_failed'

export class MemberVerificationError extends Error {
  readonly code: MemberVerificationErrorCode
}

export interface InspectedMemberRevision {
  readonly ready?: boolean
  readonly serving?: boolean
  readonly projectId: string
  readonly region: string
  readonly service: string
  readonly revision: string
  readonly image: string
  readonly runtimeIdentity: string
  readonly serviceUrl: string
}

export function createCliRevisionInspector(
  execute: (args: readonly string[]) => string,
): MemberVerificationAdapter['inspectRevision']

export function createCliVerificationAdapter(
  environment?: NodeJS.ProcessEnv,
): Promise<MemberVerificationAdapter>

export interface MemberVerificationAdapter {
  inspectRevision(target: {
    readonly projectId: string
    readonly region: string
    readonly service: string
    readonly revision: string
  }): Promise<InspectedMemberRevision>
  checkPublicHealth(revision: InspectedMemberRevision): Promise<boolean>
  checkCorsPreflight(revision: InspectedMemberRevision): Promise<boolean>
  checkMissingToken(revision: InspectedMemberRevision): Promise<boolean>
  checkWrongToken(revision: InspectedMemberRevision): Promise<boolean>
  checkRevokedToken(revision: InspectedMemberRevision): Promise<boolean>
  checkOwnerRename(revision: InspectedMemberRevision): Promise<boolean>
  checkNonOwnerDenial(revision: InspectedMemberRevision): Promise<boolean>
  checkProjectIsolation(revision: InspectedMemberRevision): Promise<boolean>
}

export interface MemberSmokeHttpResponse {
  readonly status: number
  readonly body: any
  readonly headers: Readonly<Record<string, string>>
}

export interface MemberSmokeDeviceSnapshot {
  readonly projectId: string
  readonly deviceId: string
  readonly exists: boolean
  readonly data: Readonly<Record<string, unknown>> | null
  readonly updateTime: string | null
}

export function createMemberSmokeAdapter(options: {
  environment: NodeJS.ProcessEnv
  inspectRevision: MemberVerificationAdapter['inspectRevision']
  request(input: {
    readonly method: string
    readonly url: string
    readonly headers?: Readonly<Record<string, string>>
    readonly body?: unknown
  }): Promise<MemberSmokeHttpResponse>
  readDevice(input: {
    readonly projectId: string
    readonly deviceId: string
  }): Promise<MemberSmokeDeviceSnapshot>
}): MemberVerificationAdapter

export interface MemberSmokeResult {
  readonly publicHealth: 'passed'
  readonly corsPreflight: 'passed'
  readonly missingToken: 'passed'
  readonly wrongToken: 'passed'
  readonly revokedToken: 'passed'
  readonly ownerRename: 'passed'
  readonly nonOwnerDenial: 'passed'
  readonly projectIsolation: 'passed'
}

export interface MemberReleaseRecord {
  readonly status: 'healthy' | 'failed'
  readonly projectId: string
  readonly region: string
  readonly service: string
  readonly revision: string
  readonly image: string
  readonly imageDigest: string
  readonly runtimeIdentity: string
  readonly verifiedOrigin: string
  readonly smoke: MemberSmokeResult
  readonly priorHealthyRevision?: {
    readonly revision: string
    readonly imageDigest: string
  }
}

export function runMemberVerification(options: {
  environment: NodeJS.ProcessEnv
  args: readonly string[]
  manifest: MemberManifest
  adapter: MemberVerificationAdapter
  priorRelease?: MemberReleaseRecord
  write: (line: string) => void
}): Promise<MemberReleaseRecord>

export interface MemberRollbackPlan {
  readonly status: 'ready'
  readonly dryRun: true
  readonly projectId: string
  readonly region: string
  readonly service: string
  readonly currentRevision: string
  readonly targetRevision: string
  readonly imageDigest: string
  readonly command: {
    readonly executable: 'gcloud'
    readonly args: readonly string[]
  }
}

export function runMemberRollback(options: {
  args: readonly string[]
  manifest: MemberManifest
  releaseRecord: MemberReleaseRecord | undefined
  inspectRevision: MemberVerificationAdapter['inspectRevision']
  executeTrafficMutation: (args: readonly string[]) => unknown
  write: (line: string) => void
}): Promise<MemberRollbackPlan>

export interface VerifiedMemberWebBuildPlan {
  readonly status: 'ready' | 'built'
  readonly dryRun?: true
  readonly projectId: string
  readonly service: string
  readonly revision: string
  readonly buildEnvironment: { readonly VITE_MEMBER_API_URL: string }
}

export function runVerifiedMemberWebBuildPreflight(options: {
  environment: NodeJS.ProcessEnv
  args: readonly string[]
  releaseRecord: MemberReleaseRecord | undefined
  execute: (
    command: string,
    args: readonly string[],
    environment: Readonly<Record<string, string>>,
  ) => { readonly status: number | null }
  write: (line: string) => void
}): VerifiedMemberWebBuildPlan

export function executeVerifiedWebBuild(
  command: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
): { readonly status: number | null; readonly stdout?: string; readonly stderr?: string }
