// Safe post-sign-in return route resolver.
//
// After sign-in the app may return the member to where they were headed, but the
// destination is attacker-influenced (it arrives as a query parameter). Only an
// allowlisted same-application absolute path is honored; external URLs,
// protocol-relative URLs, backslash variants, and the sign-in route itself all
// fall back to the home route. The default is always the safe one.

/** The home route every rejected candidate falls back to. */
export const HOME_PATH = '/'

/** The public sign-in route, never a valid post-sign-in destination. */
export const SIGN_IN_PATH = '/sign-in'

/**
 * Resolve a trusted in-app destination from an untrusted return-route candidate.
 * Returns HOME_PATH for anything that is not a plain same-origin absolute path.
 */
export function resolveSafeReturnPath(candidate: string | null | undefined): string {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return HOME_PATH
  }

  // Must be an absolute in-app path.
  if (!candidate.startsWith('/')) {
    return HOME_PATH
  }
  // Reject protocol-relative URLs like "//evil.test".
  if (candidate.startsWith('//')) {
    return HOME_PATH
  }
  // Reject backslash variants that browsers may normalize to "//".
  if (candidate.includes('\\')) {
    return HOME_PATH
  }

  // Reject the sign-in route itself (bare or with query/hash/subpath) to avoid a
  // redirect loop back to the login screen.
  const pathOnly = candidate.split(/[?#]/, 1)[0]
  if (pathOnly === SIGN_IN_PATH || pathOnly.startsWith(`${SIGN_IN_PATH}/`)) {
    return HOME_PATH
  }

  return candidate
}
