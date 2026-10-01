import type { ApiError } from '@agent-board/shared';
import { HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { AuthService } from './auth.service';

/** Reachable without the token, so the UI can find out it must sign in (and do so). */
const PUBLIC_PATHS = new Set(['/api/auth/status', '/api/auth/login', '/api/auth/logout']);

function normalise(path: string): string {
  // Express routes case-insensitively and ignores one trailing slash; match the same way.
  const p = path.toLowerCase().replace(/\/+$/, '');
  return p || '/';
}

/**
 * Express middleware, registered in configureApp before any route: when BOARD_TOKEN is set,
 * every HTTP request (other than the auth endpoints) needs `Authorization: Bearer <token>`
 * or the `shiftboard_token` cookie. Cookies make `<img src="/api/attachments/...">` work.
 * The Socket.IO handshake is checked separately in RealtimeGateway.
 */
export function createAuthMiddleware(auth: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!auth.required || PUBLIC_PATHS.has(normalise(req.path))) return next();
    if (auth.isAuthorized({ authorization: req.headers.authorization, cookie: req.headers.cookie })) return next();
    const body: ApiError = {
      statusCode: HttpStatus.UNAUTHORIZED,
      message: 'Sign in required: this board is protected by BOARD_TOKEN',
    };
    res.setHeader('WWW-Authenticate', 'Bearer realm="shiftboard"');
    res.status(body.statusCode).json(body);
  };
}
