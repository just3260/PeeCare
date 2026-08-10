import type { DevelopmentInventory } from './environment.mjs'

export interface DevelopmentPreflightPlan {
  readonly status: 'ready'
  readonly dryRun: true
  readonly projectId: string
  readonly firestoreRegion: string
  readonly authProvider: DevelopmentInventory['authProvider']
  readonly services: readonly ['auth', 'firestore']
  readonly operations: readonly ['deploy-firestore-rules', 'deploy-firestore-indexes']
}

export function runDevelopmentPreflight(options: {
  environment: NodeJS.ProcessEnv
  args: readonly string[]
  write: (line: string) => void
  mutation?: (inventory: DevelopmentInventory) => unknown
}): DevelopmentPreflightPlan
