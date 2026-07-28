import { timingSafeEqual } from 'node:crypto';

function equalsSecret(value: string, secret: string): boolean {
  const presented = Buffer.from(value);
  const expected = Buffer.from(secret);
  if (presented.length !== expected.length) {
    timingSafeEqual(Buffer.alloc(expected.length), expected);
    return false;
  }
  return timingSafeEqual(presented, expected);
}

export function isAuthorized(header: string | string[] | undefined, current: string, previous?: string): boolean {
  if (typeof header !== 'string') return false;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) return false;
  const token = match[1];
  return equalsSecret(token, current) || (previous ? equalsSecret(token, previous) : false);
}
