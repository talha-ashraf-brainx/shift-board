import { AUTH_COOKIE_NAME } from '@agent-board/shared';
import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/app-config';

/** Failed sign-ins allowed per client per window before POST /api/auth/login answers 429. */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 60_000;

/** Where a request or socket handshake may carry the token. */
export interface Credentials {
  /** `Authorization` header value; only `Bearer <token>` counts. */
  authorization?: string | string[];
  /** Raw `Cookie` header value. */
  cookie?: string | string[];
  /** Socket.IO `handshake.auth.token`. */
  token?: unknown;
}

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Reads one cookie from a raw `Cookie` header (values are URI-decoded, like Express's res.cookie encodes them). */
export function readCookie(header: string | string[] | undefined, name: string): string | null {
  const raw = Array.isArray(header) ? header.join('; ') : header;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/**
 * Optional shared-secret auth (BOARD_TOKEN). When the token is unset everything is allowed.
 * Tokens are compared as SHA-256 digests with timingSafeEqual, so neither the content nor
 * the length of the secret leaks through timing.
 */
@Injectable()
export class AuthService {
  private readonly expected: Buffer | null;
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(config: AppConfig) {
    this.expected = config.boardToken ? digest(config.boardToken) : null;
  }

  /** True when BOARD_TOKEN is set. */
  get required(): boolean {
    return this.expected !== null;
  }

  /** Constant-time check of one candidate token. Always false when no token is configured. */
  verify(candidate: unknown): boolean {
    if (!this.expected || typeof candidate !== 'string' || candidate.length === 0) return false;
    return timingSafeEqual(digest(candidate), this.expected);
  }

  /** True when auth is off, or any of the presented credentials holds the right token. */
  isAuthorized(c: Credentials): boolean {
    if (!this.required) return true;
    const auth = first(c.authorization);
    const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : null;
    // Check every source (no short-circuit on the first present one) so a stale cookie can't mask a good header.
    let ok = false;
    for (const candidate of [bearer, readCookie(c.cookie, AUTH_COOKIE_NAME), c.token]) {
      if (this.verify(candidate)) ok = true;
    }
    return ok;
  }

  /** Seconds until `key` may try again, or 0 when it may sign in now. */
  loginRetryAfter(key: string, now = Date.now()): number {
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= now) return 0;
    return entry.count >= LOGIN_MAX_FAILURES ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }

  recordLoginFailure(key: string, now = Date.now()): void {
    if (this.failures.size > 10_000) {
      for (const [k, v] of this.failures) if (v.resetAt <= now) this.failures.delete(k);
    }
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= now) this.failures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    else entry.count++;
  }

  recordLoginSuccess(key: string): void {
    this.failures.delete(key);
  }
}
