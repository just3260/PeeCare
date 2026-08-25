export type MemberDeploymentErrorCode =
  | 'explicit_mode_required'
  | 'immutable_image_required'
  | 'invalid_revision_suffix'
  | 'invalid_manifest'
  | 'target_mismatch'
  | 'missing_budget_record'
  | 'forbidden_runtime_configuration'
  | 'invalid_claim_secret_reference'
  | 'invalid_hmac_secret_reference'
  | 'claim_credentials_not_independent'
  | 'invalid_hmac_key_version'
  | 'invalid_shared_publisher'
  | 'runtime_identity_failed'
  | 'iam_binding_failed'
  | 'iam_drift_detected'
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
  readonly iam: {
    readonly projectRoles: readonly string[]
    readonly secretAccess: readonly {
      readonly secret: string
      readonly role: 'roles/secretmanager.secretAccessor'
    }[]
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
    readonly protectedMutationPath: '/v1/devices/:deviceId/display-name'
    readonly memberClaimPaths: readonly [
      '/v1/device-claim-sessions',
      '/v1/device-claim-sessions/:sessionId',
    ]
    readonly emqxClaimPath: '/v1/emqx/device-claims'
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
    readonly requiredValues: readonly [
      'PEECARE_PAIR_CODE_HMAC_KEY_VERSION',
      'PEECARE_CLAIM_SHARED_MQTT_USERNAME',
    ]
    readonly secretBindings: {
      readonly PEECARE_CLAIM_WEBHOOK_SECRET: {
        readonly secret: 'peecare-claim-webhook-current'
        readonly referenceEnvironment: 'PEECARE_CLAIM_WEBHOOK_SECRET_CURRENT_REF'
      }
      readonly PEECARE_PAIR_CODE_HMAC_KEY: {
        readonly secret: 'peecare-pair-code-hmac-key'
        readonly referenceEnvironment: 'PEECARE_PAIR_CODE_HMAC_KEY_REF'
      }
    }
  }
  readonly persistenceAccess: {
    readonly enforcement: {
      readonly iam: 'database-wide-datastore-role-with-direct-binding-audit'
      readonly logicalScope: 'application-repository-and-release-probe'
    }
    readonly deviceRegistry: {
      readonly reads: 'enabled-registry-fields-only'
      readonly ownerUidMutation: 'first-set-only'
    }
    readonly claimCollections: {
      readonly deviceClaimSessions: readonly ['create', 'read', 'update']
      readonly activeDeviceClaims: readonly ['create', 'read', 'update']
    }
    readonly deniedMutations: readonly [
      'owner-transfer',
      'device-delete',
      'device-child-write',
    ]
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
  readonly runtimeEnvironment: {
    readonly values: MemberManifest['runtimeEnvironment']['values']
    readonly platformProvided: MemberManifest['runtimeEnvironment']['platformProvided']
    readonly requiredValues: MemberManifest['runtimeEnvironment']['requiredValues']
    readonly secretBindings: {
      readonly PEECARE_CLAIM_WEBHOOK_SECRET: {
        readonly secret: 'peecare-claim-webhook-current'
        readonly version: string
      }
      readonly PEECARE_PAIR_CODE_HMAC_KEY: {
        readonly secret: 'peecare-pair-code-hmac-key'
        readonly version: string
      }
    }
  }
  readonly persistenceAccess: MemberManifest['persistenceAccess']
  readonly resources: MemberManifest['resources']
  readonly network: MemberManifest['network']
  readonly budgetRecord: string
}

export function loadMemberManifest(path?: string): MemberManifest

export function resolveMemberClaimConfiguration(environment: NodeJS.ProcessEnv): {
  readonly claimSecretVersion: string
  readonly hmacSecretVersion: string
  readonly hmacKeyVersion: string
  readonly sharedUsername: string
}

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
