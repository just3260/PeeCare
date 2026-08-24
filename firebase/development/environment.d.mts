export type DevelopmentInventoryErrorCode =
  | 'missing_inventory'
  | 'invalid_inventory'
  | 'forbidden_target'
  | 'non_allowlisted_target'
  | 'operator_confirmation_required'

export class DevelopmentInventoryError extends Error {
  readonly code: DevelopmentInventoryErrorCode
}

export interface DevelopmentInventory {
  readonly projectId: string
  readonly firestoreRegion: string
  readonly billingOwner: string
  readonly authProvider: typeof APPROVED_AUTH_PROVIDER
  readonly authProviders: readonly [typeof APPROVED_AUTH_PROVIDER]
  readonly operatorConfirmation: typeof REQUIRED_OPERATOR_CONFIRMATION
}

export const REQUIRED_OPERATOR_CONFIRMATION: 'APPROVE_DEVELOPMENT_FIREBASE_MUTATION'
export const APPROVED_AUTH_PROVIDER: 'google.com'

export function parseDevelopmentInventory(
  environment: NodeJS.ProcessEnv,
): DevelopmentInventory

export function guardDevelopmentMutation<Result>(
  environment: NodeJS.ProcessEnv,
  mutation: (inventory: DevelopmentInventory) => Result,
): Result
