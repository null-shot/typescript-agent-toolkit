import { describe, expect, it } from "vitest"
import { DEFAULT_IGNORE_PATTERNS, shouldIgnorePath } from "./ignore-patterns.js"

describe("shouldIgnorePath", () => {
	it("still ignores built-in generated and metadata directories", () => {
		expect(shouldIgnorePath("/node_modules/react/index.js")).toBe(true)
		expect(shouldIgnorePath("/.claude/settings.local.json")).toBe(true)
		expect(shouldIgnorePath("/.cursor/session.json")).toBe(true)
		expect(shouldIgnorePath("/dist/index.js")).toBe(true)
		expect(shouldIgnorePath("/.cloudflare/cache/state.json")).toBe(true)
	})

	it("does not ignore worker-configuration.d.ts", () => {
		expect(DEFAULT_IGNORE_PATTERNS).not.toContain("worker-configuration.d.ts")
		expect(shouldIgnorePath("/worker-configuration.d.ts")).toBe(false)
		expect(shouldIgnorePath("/apps/demo/worker-configuration.d.ts")).toBe(false)
	})

	it("still respects project-specific ignore patterns", () => {
		expect(shouldIgnorePath("/internal-docs/spec.md", ["/internal-docs"])).toBe(true)
		expect(shouldIgnorePath("/src/index.ts", ["/internal-docs"])).toBe(false)
	})
})
