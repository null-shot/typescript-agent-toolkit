import { describe, it, expect } from "vitest"
import { signJWT, verifyJWT, createToken, JWTError, jwtAuth } from "./jwt"
import type { JWTPayload, JWTOptions } from "./jwt"

const TEST_SECRET = "test-secret-key-for-jwt-tests-only"

describe("JWT Module", () => {
	describe("signJWT / verifyJWT", () => {
		it("should sign and verify a basic payload", async () => {
			const payload: JWTPayload = {
				sub: "user-123",
				name: "Test User",
			}
			const token = await signJWT(payload, TEST_SECRET)

			expect(token).toBeDefined()
			expect(token.split(".")).toHaveLength(3)

			const decoded = await verifyJWT(token, { secret: TEST_SECRET })
			expect(decoded.sub).toBe("user-123")
			expect(decoded.name).toBe("Test User")
		})

		it("should reject token with wrong secret", async () => {
			const payload: JWTPayload = { sub: "user-123" }
			const token = await signJWT(payload, TEST_SECRET)

			await expect(
				verifyJWT(token, { secret: "wrong-secret" })
			).rejects.toThrow(JWTError)
			await expect(
				verifyJWT(token, { secret: "wrong-secret" })
			).rejects.toThrow("Invalid signature")
		})

		it("should reject malformed token", async () => {
			await expect(
				verifyJWT("not-a-jwt", { secret: TEST_SECRET })
			).rejects.toThrow("Invalid token format")
		})

		it("should reject token with only two parts", async () => {
			await expect(
				verifyJWT("part1.part2", { secret: TEST_SECRET })
			).rejects.toThrow("Invalid token format")
		})

		it("should reject expired token", async () => {
			const payload: JWTPayload = {
				sub: "user-123",
				exp: Math.floor(Date.now() / 1000) - 100, // expired 100 seconds ago
			}
			const token = await signJWT(payload, TEST_SECRET)

			await expect(
				verifyJWT(token, { secret: TEST_SECRET })
			).rejects.toThrow("Token expired")
		})

		it("should accept token within clock tolerance", async () => {
			const payload: JWTPayload = {
				sub: "user-123",
				exp: Math.floor(Date.now() / 1000) - 5, // expired 5 seconds ago
			}
			const token = await signJWT(payload, TEST_SECRET)

			const decoded = await verifyJWT(token, {
				secret: TEST_SECRET,
				clockTolerance: 10, // 10 seconds tolerance
			})
			expect(decoded.sub).toBe("user-123")
		})

		it("should validate issuer when specified", async () => {
			const payload: JWTPayload = {
				sub: "user-123",
				iss: "my-app",
			}
			const token = await signJWT(payload, TEST_SECRET)

			// Correct issuer
			const decoded = await verifyJWT(token, {
				secret: TEST_SECRET,
				issuer: "my-app",
			})
			expect(decoded.iss).toBe("my-app")

			// Wrong issuer
			await expect(
				verifyJWT(token, {
					secret: TEST_SECRET,
					issuer: "other-app",
				})
			).rejects.toThrow("Invalid issuer")
		})

		it("should validate audience when specified", async () => {
			const payload: JWTPayload = {
				sub: "user-123",
				aud: "api.example.com",
			}
			const token = await signJWT(payload, TEST_SECRET)

			// Correct audience
			const decoded = await verifyJWT(token, {
				secret: TEST_SECRET,
				audience: "api.example.com",
			})
			expect(decoded.aud).toBe("api.example.com")

			// Wrong audience
			await expect(
				verifyJWT(token, {
					secret: TEST_SECRET,
					audience: "other.example.com",
				})
			).rejects.toThrow("Invalid audience")
		})

		it("should handle array audience", async () => {
			const payload: JWTPayload = {
				sub: "user-123",
				aud: ["api.example.com", "web.example.com"],
			}
			const token = await signJWT(payload, TEST_SECRET)

			const decoded = await verifyJWT(token, {
				secret: TEST_SECRET,
				audience: "web.example.com",
			})
			expect(decoded.sub).toBe("user-123")
		})

		it("should preserve custom claims", async () => {
			const payload: JWTPayload = {
				sub: "user-123",
				role: "admin",
				permissions: ["read", "write"],
				metadata: { team: "engineering" },
			}
			const token = await signJWT(payload, TEST_SECRET)

			const decoded = await verifyJWT(token, { secret: TEST_SECRET })
			expect(decoded.role).toBe("admin")
			expect(decoded.permissions).toEqual(["read", "write"])
			expect(decoded.metadata).toEqual({ team: "engineering" })
		})
	})

	describe("createToken", () => {
		it("should create token with automatic iat, exp, jti", async () => {
			const token = await createToken(
				{ sub: "user-123", email: "test@example.com" },
				TEST_SECRET,
				3600
			)

			const decoded = await verifyJWT(token, { secret: TEST_SECRET })
			expect(decoded.sub).toBe("user-123")
			expect(decoded.email).toBe("test@example.com")
			expect(decoded.iat).toBeDefined()
			expect(decoded.exp).toBeDefined()
			expect(decoded.jti).toBeDefined()

			// Check expiration is approximately 1 hour from now
			const now = Math.floor(Date.now() / 1000)
			expect(decoded.exp).toBeGreaterThan(now + 3500)
			expect(decoded.exp).toBeLessThanOrEqual(now + 3601)
		})

		it("should use default expiration of 1 hour", async () => {
			const token = await createToken(
				{ sub: "user-123" },
				TEST_SECRET
			)

			const decoded = await verifyJWT(token, { secret: TEST_SECRET })
			const now = Math.floor(Date.now() / 1000)
			expect(decoded.exp! - decoded.iat!).toBe(3600)
		})

		it("should support custom expiration", async () => {
			const token = await createToken(
				{ sub: "user-123" },
				TEST_SECRET,
				60 // 1 minute
			)

			const decoded = await verifyJWT(token, { secret: TEST_SECRET })
			expect(decoded.exp! - decoded.iat!).toBe(60)
		})
	})

	describe("jwtAuth middleware", () => {
		it("should reject request without Authorization header", async () => {
			const middleware = jwtAuth({ secret: TEST_SECRET })

			let nextCalled = false
			const mockC = {
				req: { header: () => undefined },
				json: (data: unknown, status: number) => ({ data, status } as unknown as Response),
				set: () => {},
			}

			const result = await middleware(mockC, async () => { nextCalled = true })
			expect(nextCalled).toBe(false)
			expect((result as any).status).toBe(401)
		})

		it("should reject non-Bearer token", async () => {
			const middleware = jwtAuth({ secret: TEST_SECRET })

			let nextCalled = false
			const mockC = {
				req: { header: (name: string) => name === "Authorization" ? "Basic abc" : undefined },
				json: (data: unknown, status: number) => ({ data, status } as unknown as Response),
				set: () => {},
			}

			const result = await middleware(mockC, async () => { nextCalled = true })
			expect(nextCalled).toBe(false)
			expect((result as any).status).toBe(401)
		})

		it("should accept valid Bearer token and set jwtPayload", async () => {
			const token = await createToken(
				{ sub: "user-123" },
				TEST_SECRET
			)

			const middleware = jwtAuth({ secret: TEST_SECRET })

			let nextCalled = false
			let storedPayload: unknown = null
			const mockC = {
				req: {
					header: (name: string) =>
						name === "Authorization" ? `Bearer ${token}` : undefined,
				},
				json: (data: unknown, status: number) => ({ data, status } as unknown as Response),
				set: (key: string, value: unknown) => {
					if (key === "jwtPayload") storedPayload = value
				},
			}

			await middleware(mockC, async () => { nextCalled = true })
			expect(nextCalled).toBe(true)
			expect(storedPayload).toBeDefined()
			expect((storedPayload as JWTPayload).sub).toBe("user-123")
		})

		it("should reject invalid Bearer token", async () => {
			const middleware = jwtAuth({ secret: TEST_SECRET })

			let nextCalled = false
			const mockC = {
				req: {
					header: (name: string) =>
						name === "Authorization" ? "Bearer invalid.token.here" : undefined,
				},
				json: (data: unknown, status: number) => ({ data, status } as unknown as Response),
				set: () => {},
			}

			const result = await middleware(mockC, async () => { nextCalled = true })
			expect(nextCalled).toBe(false)
			expect((result as any).status).toBe(401)
		})

		it("should support lazy options via function", async () => {
			const token = await createToken(
				{ sub: "user-456" },
				TEST_SECRET
			)

			const middleware = jwtAuth(() => ({ secret: TEST_SECRET }))

			let nextCalled = false
			let storedPayload: unknown = null
			const mockC = {
				req: {
					header: (name: string) =>
						name === "Authorization" ? `Bearer ${token}` : undefined,
				},
				json: (data: unknown, status: number) => ({ data, status } as unknown as Response),
				set: (key: string, value: unknown) => {
					if (key === "jwtPayload") storedPayload = value
				},
			}

			await middleware(mockC, async () => { nextCalled = true })
			expect(nextCalled).toBe(true)
			expect((storedPayload as JWTPayload).sub).toBe("user-456")
		})
	})

	describe("JWTError", () => {
		it("should have correct name", () => {
			const error = new JWTError("test error")
			expect(error.name).toBe("JWTError")
			expect(error.message).toBe("test error")
			expect(error).toBeInstanceOf(Error)
		})
	})
})
