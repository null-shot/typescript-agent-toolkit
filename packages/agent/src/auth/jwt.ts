/**
 * JWT Authentication Middleware for Hono
 * Provides Bearer token validation using Web Crypto API (no external dependencies)
 * Compatible with Cloudflare Workers runtime
 */

import { Hono } from "hono"

export interface JWTPayload {
	/** Subject (user ID) */
	sub?: string
	/** Issued at */
	iat?: number
	/** Expiration time */
	exp?: number
	/** Issuer */
	iss?: string
	/** Audience */
	aud?: string | string[]
	/** JWT ID */
	jti?: string
	/** Custom claims */
	[key: string]: unknown
}

export interface JWTOptions {
	/** Secret key for HMAC-SHA256 signing/verification */
	secret: string
	/** Algorithm (default: HS256) */
	algorithm?: "HS256"
	/** Clock tolerance in seconds for expiration check (default: 0) */
	clockTolerance?: number
	/** Required issuer */
	issuer?: string
	/** Required audience */
	audience?: string
}

/**
 * Encode a string to base64url
 */
function base64urlEncode(data: Uint8Array): string {
	let base64 = ""
	const bytes = new Uint8Array(data)
	const len = bytes.byteLength
	for (let i = 0; i < len; i++) {
		base64 += String.fromCharCode(bytes[i])
	}
	return btoa(base64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Decode a base64url string
 */
function base64urlDecode(str: string): Uint8Array {
	const base64 = str.replace(/-/g, "+").replace(/_/g, "/")
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
	const binary = atob(padded)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}

/**
 * Import a secret key for HMAC-SHA256
 */
async function importKey(secret: string): Promise<CryptoKey> {
	const encoder = new TextEncoder()
	return crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"]
	)
}

/**
 * Sign a JWT token
 */
export async function signJWT(
	payload: JWTPayload,
	secret: string
): Promise<string> {
	const header = { alg: "HS256", typ: "JWT" }
	const encoder = new TextEncoder()

	const headerB64 = base64urlEncode(encoder.encode(JSON.stringify(header)))
	const payloadB64 = base64urlEncode(encoder.encode(JSON.stringify(payload)))

	const signingInput = `${headerB64}.${payloadB64}`
	const key = await importKey(secret)
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(signingInput)
	)

	const signatureB64 = base64urlEncode(new Uint8Array(signature))
	return `${signingInput}.${signatureB64}`
}

/**
 * Verify and decode a JWT token
 * Returns the payload if valid, throws if invalid
 */
export async function verifyJWT(
	token: string,
	options: JWTOptions
): Promise<JWTPayload> {
	const parts = token.split(".")
	if (parts.length !== 3) {
		throw new JWTError("Invalid token format")
	}

	const [headerB64, payloadB64, signatureB64] = parts

	// Verify header
	try {
		const headerJson = new TextDecoder().decode(base64urlDecode(headerB64))
		const header = JSON.parse(headerJson)
		if (header.alg !== "HS256") {
			throw new JWTError(`Unsupported algorithm: ${header.alg}`)
		}
	} catch (e) {
		if (e instanceof JWTError) throw e
		throw new JWTError("Invalid token header")
	}

	// Verify signature
	const encoder = new TextEncoder()
	const signingInput = `${headerB64}.${payloadB64}`
	const key = await importKey(options.secret)
	const signature = base64urlDecode(signatureB64)

	const valid = await crypto.subtle.verify(
		"HMAC",
		key,
		signature,
		encoder.encode(signingInput)
	)

	if (!valid) {
		throw new JWTError("Invalid signature")
	}

	// Decode payload
	let payload: JWTPayload
	try {
		const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64))
		payload = JSON.parse(payloadJson)
	} catch {
		throw new JWTError("Invalid token payload")
	}

	// Check expiration
	if (payload.exp) {
		const now = Math.floor(Date.now() / 1000)
		const tolerance = options.clockTolerance || 0
		if (now > payload.exp + tolerance) {
			throw new JWTError("Token expired")
		}
	}

	// Check issuer
	if (options.issuer && payload.iss !== options.issuer) {
		throw new JWTError(`Invalid issuer: expected ${options.issuer}`)
	}

	// Check audience
	if (options.audience) {
		const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
		if (!aud.includes(options.audience)) {
			throw new JWTError(`Invalid audience: expected ${options.audience}`)
		}
	}

	return payload
}

/**
 * Custom JWT error class
 */
export class JWTError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "JWTError"
	}
}

/**
 * Hono middleware that requires a valid JWT Bearer token
 *
 * @example
 * ```typescript
 * const app = new Hono()
 *
 * // Protect all routes under /api
 * app.use('/api/*', jwtAuth({ secret: env.JWT_SECRET }))
 *
 * // Access the JWT payload in handlers
 * app.get('/api/me', (c) => {
 *   const user = c.get('jwtPayload')
 *   return c.json({ userId: user.sub })
 * })
 * ```
 */
export function jwtAuth(options: JWTOptions | (() => JWTOptions)) {
	return async (c: { req: { header: (name: string) => string | undefined }; json: (data: unknown, status: number) => Response; set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
		const opts = typeof options === "function" ? options() : options
		const authHeader = c.req.header("Authorization")

		if (!authHeader) {
			return c.json({ error: "Authorization header required" }, 401)
		}

		if (!authHeader.startsWith("Bearer ")) {
			return c.json({ error: "Bearer token required" }, 401)
		}

		const token = authHeader.slice(7)

		try {
			const payload = await verifyJWT(token, opts)
			c.set("jwtPayload", payload)
			await next()
		} catch (error) {
			const message =
				error instanceof JWTError
					? error.message
					: "Authentication failed"
			return c.json({ error: message }, 401)
		}
	}
}

/**
 * Helper to create a JWT token for a user
 * Useful for login endpoints
 *
 * @example
 * ```typescript
 * app.post('/auth/login', async (c) => {
 *   // ... validate credentials ...
 *   const token = await createToken(
 *     { sub: user.id, email: user.email },
 *     c.env.JWT_SECRET,
 *     3600 // 1 hour
 *   )
 *   return c.json({ token })
 * })
 * ```
 */
export async function createToken(
	claims: Record<string, unknown>,
	secret: string,
	expiresInSeconds = 3600
): Promise<string> {
	const now = Math.floor(Date.now() / 1000)
	const payload: JWTPayload = {
		...claims,
		iat: now,
		exp: now + expiresInSeconds,
		jti: crypto.randomUUID(),
	}
	return signJWT(payload, secret)
}
