export type IngestionDeploymentErrorCode =
  | 'explicit_mode_required'
  | 'immutable_image_required'
  | 'target_mismatch'
  | 'invalid_manifest'
  | 'missing_budget_record'
  | 'invalid_runtime_environment'
  | 'emulator_environment_forbidden'
  | 'invalid_secret_reference'
  | 'runtime_identity_failed'
  | 'iam_binding_failed'
  | 'cloud_run_deploy_failed'

export class IngestionDeploymentError extends Error {
  readonly code: IngestionDeploymentErrorCode
}

export interface IngestionManifest {
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
  readonly iam: {
    readonly projectRoles: readonly string[]
    readonly secretAccessorRole: string
  }
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
    readonly protectedWebhookPath: '/v1/emqx/events'
    readonly applicationAuth: 'bearer-current-or-previous'
  }
  readonly runtimeEnvironment: {
    readonly values: {
      readonly NODE_ENV: 'production'
      readonly GOOGLE_CLOUD_PROJECT: 'petcare-c7483'
    }
    readonly secretNames: readonly [
      'EMQX_WEBHOOK_SECRET_CURRENT',
      'EMQX_WEBHOOK_SECRET_PREVIOUS',
    ]
    readonly platformProvided: readonly ['PORT']
  }
}

export interface IngestionDeploymentResult {
  readonly status: 'ready' | 'deployed'
  readonly dryRun?: true
  readonly projectId: string
  readonly region: string
  readonly service: string
  readonly image: string
  readonly imageDigest: string
  readonly runtimeIdentity: string
  readonly iam: {
    readonly projectRoles: readonly string[]
    readonly secretAccessorRole: string
  }
  readonly secretRefs: Readonly<Record<string, string>>
  readonly resources: IngestionManifest['resources']
  readonly network: IngestionManifest['network']
  readonly runtimeEnvironment: IngestionManifest['runtimeEnvironment']
  readonly budgetRecord: string
}

export function loadIngestionManifest(path?: string): IngestionManifest

export function runIngestionDeploy(options: {
  environment: NodeJS.ProcessEnv
  args: readonly string[]
  manifest: IngestionManifest
  execute: (command: string, args: readonly string[]) => {
    readonly status: number | null
    readonly stdout?: string
  }
  write: (line: string) => void
}): IngestionDeploymentResult
