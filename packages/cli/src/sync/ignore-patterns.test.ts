import { describe, expect, it } from "vitest"
import { DEFAULT_IGNORE_PATTERNS, shouldIgnorePath } from "./ignore-patterns.js"

describe("sync ignore patterns", () => {
	it("does not ignore worker-configuration.d.ts during sync", () => {
		expect(DEFAULT_IGNORE_PATTERNS).not.toContain("worker-configuration.d.ts")
		expect(shouldIgnorePath("/worker-configuration.d.ts")).toBe(false)
	})

	it("still ignores generated cloudflare directories", () => {
		expect(shouldIgnorePath("/.cloudflare/cache/state.json")).toBe(true)
	})
})
