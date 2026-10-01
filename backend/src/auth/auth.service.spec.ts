import type { Request, Response } from 'express';
import type { AppConfig } from '../config/app-config';
import { createAuthMiddleware } from './auth.middleware';
import { AuthService, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, readCookie } from './auth.service';

const TOKEN = 'correct-horse-battery-staple';
const make = (boardToken: string | null) => new AuthService({ boardToken } as AppConfig);

describe('readCookie', () => {
  it('finds and decodes one cookie', () => {
    expect(readCookie('a=1; shiftboard_token=x%20y; b=2', 'shiftboard_token')).toBe('x y');
    expect(readCookie('shiftboard_token="q"', 'shiftboard_token')).toBe('q');
    expect(readCookie('xshiftboard_token=1', 'shiftboard_token')).toBeNull();
    expect(readCookie(undefined, 'shiftboard_token')).toBeNull();
    expect(readCookie('bad=%E0%A4%A', 'bad')).toBe('%E0%A4%A');
  });
});

describe('AuthService', () => {
  it('allows everything when BOARD_TOKEN is unset', () => {
    const auth = make(null);
    expect(auth.required).toBe(false);
    expect(auth.isAuthorized({})).toBe(true);
    expect(auth.verify('anything')).toBe(false);
  });

  it('accepts the token as a Bearer header, the cookie or a socket auth token', () => {
    const auth = make(TOKEN);
    expect(auth.required).toBe(true);
    expect(auth.isAuthorized({})).toBe(false);
    expect(auth.isAuthorized({ authorization: `Bearer ${TOKEN}` })).toBe(true);
    expect(auth.isAuthorized({ authorization: `bearer  ${TOKEN}` })).toBe(true);
    expect(auth.isAuthorized({ authorization: TOKEN })).toBe(false);
    expect(auth.isAuthorized({ authorization: `Basic ${TOKEN}` })).toBe(false);
    expect(auth.isAuthorized({ cookie: `shiftboard_token=${encodeURIComponent(TOKEN)}` })).toBe(true);
    expect(auth.isAuthorized({ token: TOKEN })).toBe(true);
    expect(auth.isAuthorized({ token: 42 })).toBe(false);
    // A stale cookie doesn't mask a good header.
    expect(auth.isAuthorized({ authorization: `Bearer ${TOKEN}`, cookie: 'shiftboard_token=old' })).toBe(true);
  });

  it('rejects wrong, empty, prefix and longer tokens', () => {
    const auth = make(TOKEN);
    for (const t of ['', 'nope', TOKEN.slice(0, -1), `${TOKEN}x`, TOKEN.toUpperCase()]) expect(auth.verify(t)).toBe(false);
    expect(auth.verify(TOKEN)).toBe(true);
  });

  it('rate-limits failed sign-ins per client within a window', () => {
    const auth = make(TOKEN);
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) auth.recordLoginFailure('a', now);
    expect(auth.loginRetryAfter('a', now)).toBe(0);
    auth.recordLoginFailure('a', now);
    expect(auth.loginRetryAfter('a', now)).toBe(LOGIN_WINDOW_MS / 1000);
    expect(auth.loginRetryAfter('b', now)).toBe(0);
    expect(auth.loginRetryAfter('a', now + LOGIN_WINDOW_MS)).toBe(0);
    auth.recordLoginFailure('a', now);
    auth.recordLoginSuccess('a');
    expect(auth.loginRetryAfter('a', now)).toBe(0);
  });
});

describe('createAuthMiddleware', () => {
  function run(auth: AuthService, path: string, headers: Record<string, string> = {}) {
    const next = jest.fn();
    const res = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    createAuthMiddleware(auth)({ path, headers } as unknown as Request, res as unknown as Response, next);
    return { next, res };
  }

  it('passes everything through when auth is off', () => {
    expect(run(make(null), '/api/tickets').next).toHaveBeenCalled();
  });

  it('answers 401 JSON without the token, except for the auth endpoints', () => {
    const auth = make(TOKEN);
    const { next, res } = run(auth, '/api/tickets');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 401, message: expect.stringContaining('BOARD_TOKEN') });
    // Express matches routes case-insensitively, so the guard must not be fooled by casing.
    expect(run(auth, '/API/tickets').next).not.toHaveBeenCalled();
    for (const p of ['/api/auth/status', '/api/auth/login', '/api/auth/logout/', '/API/Auth/Status']) {
      expect(run(auth, p).next).toHaveBeenCalled();
    }
    expect(run(auth, '/api/auth/statusx').next).not.toHaveBeenCalled();
    expect(run(auth, '/api/tickets', { authorization: `Bearer ${TOKEN}` }).next).toHaveBeenCalled();
  });
});
