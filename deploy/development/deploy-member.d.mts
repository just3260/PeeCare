export type MemberDeploymentErrorCode =
  | 'explicit_mode_required'
  | 'immutable_image_required'
  | 'invalid_revision_suffix'
  | 'invalid_manifest'
  | 'target_mismatch'
  | 'missing_budget_record'
  | 'forbidden_runtime_configuration'
  | 'runtime_identity_failed'
  | 'iam_binding_failed'
  | 'cloud_run_deploy_failed'

export class MemberDeploymentError extends Error {
  readonly code: MemberDeploymentErrorCode
}

export interface MemberManifest {
  readonly apiVersion: 'peecare.dev/v1'
  readonly kind: 'CloudRunService'
  readonly metadata: {
    readonly projectId: string
    readonly region: string
    readonly service: string
  }
  readonly image: { readonly digestPattern: string }
  readonly runtimeIdentity: {
    readonly serviceAccount: string
    readonly accountId: string
    readonly displayName: string
  }
  readonly iam: { readonly projectRoles: readonly string[] }
  readonly resources: {
    readonly billing: 'request-based'
    readonly cpu: '1'
    readonly memory: '512Mi'
    readonly timeoutSeconds: 60
    readonly concurrency: 20
    readonly minInstances: 0
    readonly maxInstances: 2
  }
  readonly network: {
    readonly ingress: 'all'
    readonly allowUnauthenticated: true
    readonly publicHealthPath: '/health'
    readonly protectedMutationPath: '/v1/devices/:deviceId/display-name'
    readonly applicationAuth: 'firebase-id-token-revoked-aware-owner'
    readonly allowedOrigin: 'https://petcare-c7483.web.app'
  }
  readonly runtimeEnvironment: {
    readonly values: {
      readonly NODE_ENV: 'production'
      readonly GOOGLE_CLOUD_PROJECT: 'petcare-c7483'
      readonly PEECARE_WEB_ORIGIN: 'https://petcare-c7483.web.app'
    }
    readonly platformProvided: readonly ['PORT']
  }
}

export interface MemberDeploymentResult {
  readonly status: 'ready' | 'deployed'
  readonly dryRun?: true
  readonly projectId: string
  readonly region: string
  readonly service: string
  readonly revision: string
  readonly image: string
  readonly imageDigest: string
  readonly runtimeIdentity: string
  readonly iam: MemberManifest['iam']
  readonly runtimeEnvironment: MemberManifest['runtimeEnvironment']
  readonly resources: MemberManifest['resources']
  readonly network: MemberManifest['network']
  readonly budgetRecord: string
}

export function loadMemberManifest(path?: string): MemberManifest

export function runMemberDeploy(options: {
  environment: NodeJS.ProcessEnv
  args: readonly string[]
  manifest: MemberManifest
  execute: (command: string, args: readonly string[]) => {
    readonly status: number | null
    readonly stdout?: string
  }
  write: (line: string) => void
}): MemberDeploymentResult
