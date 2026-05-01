import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface AuthCredentials {
	sessionToken: string
	userId: string
	userName: string | null
	email: string | null
	expiresAt: number
	baseUrl: string
}

/** Default API environment when `--api-url` is omitted. */
export const DEFAULT_API_URL = "https://nullshot.ai"

const AUTH_DIR = path.join(os.homedir(), ".nullshot")
const AUTH_FILE = path.join(AUTH_DIR, "auth.json")

export interface AuthFileV2 {
	version: 2
	credentialsByUrl: Record<string, AuthCredentials>
}

function authFilePath(): string {
	return process.env.NULLSHOT_AUTH_FILE ?? AUTH_FILE
}

/** Normalize API base URL for stable map keys (matches NullshotApiClient trailing-slash behavior). */
export function normalizeApiUrl(url: string): string {
	const trimmed = url.trim()
	if (!trimmed) return DEFAULT_API_URL
	try {
		const u = new URL(trimmed)
		// Rebuild origin + pathname without trailing slash on pathname-only edge cases
		let out = `${u.protocol}//${u.host}${u.pathname}`
		out = out.replace(/\/$/, "")
		return out || DEFAULT_API_URL
	} catch {
		return trimmed.replace(/\/$/, "") || DEFAULT_API_URL
	}
}

function decodeJwtExpiresAt(token: string): number | null {
	const payload = token.split(".")[1]
	if (!payload) return null

	try {
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
		const paddingLength = (4 - (normalized.length % 4)) % 4
		const padded = normalized.padEnd(normalized.length + paddingLength, "=")
		const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as unknown
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null

		const exp = (parsed as Record<string, unknown>).exp
		return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null
	} catch {
		return null
	}
}

function effectiveExpiresAt(creds: AuthCredentials): number {
	const jwtExpiresAt = decodeJwtExpiresAt(creds.sessionToken)
	if (jwtExpiresAt !== null) {
		return creds.expiresAt ? Math.min(creds.expiresAt, jwtExpiresAt) : jwtExpiresAt
	}
	return creds.expiresAt
}

function isExpired(creds: AuthCredentials): boolean {
	const expiresAt = effectiveExpiresAt(creds)
	return Boolean(expiresAt && expiresAt < Date.now())
}

function normalizeCredentials(creds: AuthCredentials): AuthCredentials {
	return {
		...creds,
		baseUrl: normalizeApiUrl(creds.baseUrl),
		expiresAt: effectiveExpiresAt(creds),
	}
}

function isLegacyV1Shape(parsed: unknown): parsed is AuthCredentials {
	if (!parsed || typeof parsed !== "object") return false
	const o = parsed as Record<string, unknown>
	return (
		typeof o.sessionToken === "string" &&
		(o.version === undefined || o.version !== 2) &&
		!("credentialsByUrl" in o)
	)
}

function isV2Shape(parsed: unknown): parsed is AuthFileV2 {
	if (!parsed || typeof parsed !== "object") return false
	const o = parsed as Record<string, unknown>
	return o.version === 2 && o.credentialsByUrl !== null && typeof o.credentialsByUrl === "object"
}

function readRawFile(): string | null {
	const file = authFilePath()
	try {
		if (!fs.existsSync(file)) return null
		return fs.readFileSync(file, "utf-8")
	} catch {
		return null
	}
}

function parseStoredCredentials(raw: string | null): {
	credentialsByUrl: Record<string, AuthCredentials>
} {
	if (!raw) return { credentialsByUrl: {} }
	let parsed: unknown
	try {
		parsed = JSON.parse(raw) as unknown
	} catch {
		return { credentialsByUrl: {} }
	}

	if (isV2Shape(parsed)) {
		return { credentialsByUrl: { ...parsed.credentialsByUrl } }
	}

	if (isLegacyV1Shape(parsed)) {
		const base = normalizeApiUrl(parsed.baseUrl || DEFAULT_API_URL)
		const creds: AuthCredentials = {
			...parsed,
			baseUrl: base,
		}
		if (isExpired(creds)) {
			return { credentialsByUrl: {} }
		}
		return { credentialsByUrl: { [base]: creds } }
	}

	return { credentialsByUrl: {} }
}

function dropExpiredEntries(map: Record<string, AuthCredentials>): Record<string, AuthCredentials> {
	const next: Record<string, AuthCredentials> = {}
	for (const [key, creds] of Object.entries(map)) {
		if (!isExpired(creds)) {
			next[key] = normalizeCredentials(creds)
		}
	}
	return next
}

function writeV2(credentialsByUrl: Record<string, AuthCredentials>): void {
	const file = authFilePath()
	const dir = path.dirname(file)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
	const payload: AuthFileV2 = {
		version: 2,
		credentialsByUrl,
	}
	fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8")
	fs.chmodSync(file, 0o600)
}

export class AuthManager {
	/**
	 * Credentials for the given API URL, or default production URL when omitted.
	 */
	static getCredentials(apiUrl?: string): AuthCredentials | null {
		const key = normalizeApiUrl(apiUrl ?? DEFAULT_API_URL)
		const { credentialsByUrl } = parseStoredCredentials(readRawFile())
		const cleaned = dropExpiredEntries(credentialsByUrl)
		const creds = cleaned[key]
		return creds ?? null
	}

	/** All non-expired saved sessions, sorted by base URL. */
	static getAllCredentials(): AuthCredentials[] {
		const { credentialsByUrl } = parseStoredCredentials(readRawFile())
		const cleaned = dropExpiredEntries(credentialsByUrl)
		return Object.values(cleaned).sort((a, b) => a.baseUrl.localeCompare(b.baseUrl))
	}

	static saveCredentials(creds: AuthCredentials): void {
		const key = normalizeApiUrl(creds.baseUrl)
		const normalized = normalizeCredentials({ ...creds, baseUrl: key })
		const { credentialsByUrl } = parseStoredCredentials(readRawFile())
		let merged = dropExpiredEntries(credentialsByUrl)
		merged[key] = normalized
		writeV2(merged)
	}

	/**
	 * Clear stored credentials. No `apiUrl` clears every environment.
	 */
	static clearCredentials(apiUrl?: string): void {
		const file = authFilePath()
		if (!apiUrl) {
			try {
				if (fs.existsSync(file)) {
					fs.unlinkSync(file)
				}
			} catch {
				// ignore
			}
			return
		}
		const key = normalizeApiUrl(apiUrl)
		const { credentialsByUrl } = parseStoredCredentials(readRawFile())
		let merged = dropExpiredEntries(credentialsByUrl)
		if (!(key in merged)) {
			return
		}
		delete merged[key]
		if (Object.keys(merged).length === 0) {
			try {
				if (fs.existsSync(file)) {
					fs.unlinkSync(file)
				}
			} catch {
				// ignore
			}
			return
		}
		writeV2(merged)
	}

	static isAuthenticated(): boolean {
		return AuthManager.getAllCredentials().length > 0
	}

	static getAuthFilePath(): string {
		return authFilePath()
	}
}
