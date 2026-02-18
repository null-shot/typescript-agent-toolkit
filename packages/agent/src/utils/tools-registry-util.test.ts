import { describe, it, expect } from "vitest"
import { ToolsRegistryUtil } from "./tools-registry-util"

describe("ToolsRegistryUtil", () => {
	describe("generateFromConfig", () => {
		it("should generate base64-encoded config by default", () => {
			const config = { tools: ["tool1", "tool2"], version: 1 }
			const result = ToolsRegistryUtil.generateFromConfig(config)

			// Should be base64
			const decoded = JSON.parse(atob(result))
			expect(decoded).toEqual(config)
		})

		it("should generate JSON string when format is json", () => {
			const config = { tools: ["tool1"], meta: { key: "value" } }
			const result = ToolsRegistryUtil.generateFromConfig(config, "json")

			expect(result).toBe(JSON.stringify(config))
			expect(JSON.parse(result)).toEqual(config)
		})

		it("should handle empty config object", () => {
			const result = ToolsRegistryUtil.generateFromConfig({})
			const decoded = JSON.parse(atob(result))
			expect(decoded).toEqual({})
		})

		it("should handle nested config objects", () => {
			const config = {
				servers: [
					{ url: "https://example.com", name: "test" },
					{ url: "https://other.com", name: "other" },
				],
				settings: { timeout: 5000, retries: 3 },
			}
			const result = ToolsRegistryUtil.generateFromConfig(config)
			const decoded = JSON.parse(atob(result))
			expect(decoded).toEqual(config)
		})

		it("should handle config with special characters", () => {
			const config = { name: "test/with/slashes", desc: "hello & world <>" }
			const result = ToolsRegistryUtil.generateFromConfig(config)
			const decoded = JSON.parse(atob(result))
			expect(decoded).toEqual(config)
		})

		it("should throw on circular references", () => {
			const config: Record<string, unknown> = { key: "value" }
			config.self = config
			expect(() => ToolsRegistryUtil.generateFromConfig(config)).toThrow()
		})
	})

	describe("parseRegistry", () => {
		it("should parse JSON string", () => {
			const config = { tools: ["a", "b"] }
			const jsonStr = JSON.stringify(config)
			const result = ToolsRegistryUtil.parseRegistry(jsonStr)
			expect(result).toEqual(config)
		})

		it("should parse base64-encoded JSON", () => {
			const config = { tools: ["a", "b"] }
			const base64 = btoa(JSON.stringify(config))
			const result = ToolsRegistryUtil.parseRegistry(base64)
			expect(result).toEqual(config)
		})

		it("should return null for invalid input", () => {
			const result = ToolsRegistryUtil.parseRegistry("not-valid-json-or-base64!!!")
			expect(result).toBeNull()
		})

		it("should return null for empty string", () => {
			// Empty string is valid base64 but decodes to empty string which isn't valid JSON
			const result = ToolsRegistryUtil.parseRegistry("")
			expect(result).toBeNull()
		})

		it("should roundtrip with generateFromConfig (base64)", () => {
			const config = { servers: [{ url: "https://test.com" }], version: 2 }
			const encoded = ToolsRegistryUtil.generateFromConfig(config, "base64")
			const decoded = ToolsRegistryUtil.parseRegistry(encoded)
			expect(decoded).toEqual(config)
		})

		it("should roundtrip with generateFromConfig (json)", () => {
			const config = { servers: [{ url: "https://test.com" }], version: 2 }
			const encoded = ToolsRegistryUtil.generateFromConfig(config, "json")
			const decoded = ToolsRegistryUtil.parseRegistry(encoded)
			expect(decoded).toEqual(config)
		})
	})
})
