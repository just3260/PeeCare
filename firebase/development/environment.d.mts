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
  readonly authProvider: 'password' | 'phone' | 'google.com' | 'apple.com'
  readonly operatorConfirmation: typeof REQUIRED_OPERATOR_CONFIRMATION
}

export const REQUIRED_OPERATOR_CONFIRMATION: 'APPROVE_DEVELOPMENT_FIREBASE_MUTATION'

export function parseDevelopmentInventory(
  environment: NodeJS.ProcessEnv,
): DevelopmentInventory

export function guardDevelopmentMutation<Result>(
  environment: NodeJS.ProcessEnv,
  mutation: (inventory: DevelopmentInventory) => Result,
): Result
