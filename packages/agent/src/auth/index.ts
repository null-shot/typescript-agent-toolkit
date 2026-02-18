/**
 * Authentication Module
 * JWT-based auth middleware for Cloudflare Workers
 */

export {
	jwtAuth,
	signJWT,
	verifyJWT,
	createToken,
	JWTError,
	type JWTPayload,
	type JWTOptions,
} from "./jwt"
