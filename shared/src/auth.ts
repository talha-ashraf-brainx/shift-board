/** Name of the HttpOnly cookie that carries BOARD_TOKEN after a successful login. */
export const AUTH_COOKIE_NAME = 'shiftboard_token';

/** GET /api/auth/status (always allowed, even without the token). */
export interface AuthStatusDto {
  /** True when the server has BOARD_TOKEN set. */
  required: boolean;
  /** True when no token is required, or this request presented a valid one. */
  authenticated: boolean;
}

/** POST /api/auth/login body. */
export interface LoginInput {
  token: string;
}
