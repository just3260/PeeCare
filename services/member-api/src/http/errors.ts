export type MemberApiErrorCode =
  | 'invalid_request'
  | 'invalid_device_id'
  | 'invalid_custom_name'
  | 'unauthorized'
  | 'device_not_found'
  | 'body_too_large'
  | 'unsupported_media_type'
  | 'malformed_json'
  | 'method_not_allowed'
  | 'persistence_unavailable'
  | 'internal_error'
  | 'not_found';

export class PersistenceUnavailableError extends Error {
  readonly code = 'persistence_unavailable' as const;

  constructor() {
    super('Persistence is temporarily unavailable.');
    this.name = 'PersistenceUnavailableError';
    Object.setPrototypeOf(this, PersistenceUnavailableError.prototype);
  }
}
