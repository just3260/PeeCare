const MAX_CUSTOM_NAME_CODE_POINTS = 30;
const FORBIDDEN_CUSTOM_NAME_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/u;

export type CustomNameNormalization =
  | { readonly kind: 'set'; readonly value: string }
  | { readonly kind: 'delete' };

export class InvalidCustomNameError extends Error {
  readonly code = 'invalid_custom_name' as const;

  constructor() {
    // Keep member-provided content out of errors because callers may log them.
    super('The custom name is invalid.');
    this.name = 'InvalidCustomNameError';
    Object.setPrototypeOf(this, InvalidCustomNameError.prototype);
  }
}

/**
 * Convert a validated request value into the only two persistence commands.
 * Request-shape validation owns non-string values before this domain boundary.
 */
export function normalizeCustomName(customName: string | null): CustomNameNormalization {
  if (customName === null) {
    return { kind: 'delete' };
  }

  // Validate the submitted value before trimming so forbidden characters at
  // either edge cannot disappear into an apparently valid canonical name.
  if (FORBIDDEN_CUSTOM_NAME_CHARACTERS.test(customName)) {
    throw new InvalidCustomNameError();
  }

  const canonicalName = customName.trim();
  if (canonicalName.length === 0) {
    return { kind: 'delete' };
  }

  const codePointCount = Array.from(canonicalName).length;
  if (codePointCount > MAX_CUSTOM_NAME_CODE_POINTS) {
    throw new InvalidCustomNameError();
  }

  return { kind: 'set', value: canonicalName };
}
