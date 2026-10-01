import { AUTH_COOKIE_NAME, type AuthStatusDto } from '@agent-board/shared';
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './login.dto';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** HttpOnly so page scripts can't read it; Strict so other sites can't ride on it. No Secure: the board is served over http://localhost. */
const COOKIE_OPTIONS: CookieOptions = { httpOnly: true, sameSite: 'strict', path: '/' };

/** These three routes are exempt from the auth middleware (see auth.middleware.ts). */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('status')
  status(@Req() req: Request): AuthStatusDto {
    return {
      required: this.auth.required,
      authenticated: this.auth.isAuthorized({ authorization: req.headers.authorization, cookie: req.headers.cookie }),
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): { ok: true } {
    if (!this.auth.required) return { ok: true };
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const retryAfter = this.auth.loginRetryAfter(key);
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(`Too many sign-in attempts. Try again in ${retryAfter}s.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!this.auth.verify(body.token)) {
      this.auth.recordLoginFailure(key);
      throw new UnauthorizedException('Wrong board token');
    }
    this.auth.recordLoginSuccess(key);
    res.cookie(AUTH_COOKIE_NAME, body.token, { ...COOKIE_OPTIONS, maxAge: ONE_YEAR_MS });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(AUTH_COOKIE_NAME, COOKIE_OPTIONS);
    return { ok: true };
  }
}
