const RULES = [
  {
    name: 'hardcoded_bearer',
    pattern: /["']?authorization["']?\s*:\s*["'`]?\s*bearer\s+[a-z0-9._~+\/-]{12,}/iu,
  },
  {
    name: 'hardcoded_secret_assignment',
    pattern: /["']?[a-z0-9_$]*(?:secret|token|password|credential|api_?key)[a-z0-9_$]*["']?\s*[:=]\s*["'`][^\s"'`]{12,}["'`]/iu,
  },
  {
    name: 'docker_secret_assignment',
    pattern: /\b(?:ENV|ARG)\s+[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|API_?KEY)[A-Z0-9_]*(?:\s+|\s*=\s*)["']?[^\s"']{12,}["']?/iu,
  },
  {
    name: 'private_key_pem',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
  {
    name: 'service_account_private_key',
    pattern: /["']private_key["']\s*:\s*["'][^"']+/u,
  },
  {
    name: 'google_api_key',
    pattern: /AIza[0-9A-Za-z_-]{20,}/u,
  },
] as const;

export function findPrivacyLeaks(text: string): readonly string[] {
  return RULES.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}
