export interface DevelopmentReadinessAdapter {
  readAuthConfiguration(): Promise<{
    readonly enabledProviders: readonly string[]
    readonly authorizedDomains: readonly string[]
  }>
  readRequiredIndexes(): Promise<
    readonly {
      readonly collectionGroup: string
      readonly state: string
      readonly fields: readonly string[]
    }[]
  >
  runRulesProbes(identity: {
    readonly marker: string
    readonly ownerUid: string
    readonly nonOwnerUid: string
    readonly deviceId: string
    readonly webApiKey: string
  }): Promise<{
    readonly ownerReadAllowed: boolean
    readonly nonOwnerReadDenied: boolean
    readonly anonymousReadDenied: boolean
    readonly clientWriteDenied: boolean
  }>
}

export class DevelopmentReadinessError extends Error {
  readonly code:
    | 'readiness_config_missing'
    | 'readiness_config_invalid'
    | 'auth_provider_not_ready'
    | 'authorized_domain_not_ready'
    | 'firestore_index_not_ready'
    | 'firestore_rules_probe_failed'
}

export function runDevelopmentReadiness(options: {
  environment: NodeJS.ProcessEnv
  adapter: DevelopmentReadinessAdapter
  write: (line: string) => void
}): Promise<Record<string, unknown>>
