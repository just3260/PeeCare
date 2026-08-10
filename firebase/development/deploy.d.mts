export type DevelopmentDeploymentErrorCode =
  | 'explicit_mode_required'
  | 'firebase_deploy_failed'

export class DevelopmentDeploymentError extends Error {
  readonly code: DevelopmentDeploymentErrorCode
}

export interface DevelopmentDeployResult {
  readonly status: 'ready' | 'deployed'
  readonly dryRun?: true
  readonly projectId: string
  readonly database: '(default)'
  readonly resources: readonly ['firestore.rules', 'firestore.indexes.json']
}

export function runDevelopmentDeploy(options: {
  environment: NodeJS.ProcessEnv
  args: readonly string[]
  execute: (command: string, args: readonly string[]) => { readonly status: number | null }
  write: (line: string) => void
}): DevelopmentDeployResult
