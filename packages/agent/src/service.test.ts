import { describe, it, expect } from "vitest"
import { isExternalService } from "./service"
import type { Service, ExternalService, EventService, Event } from "./service"

describe("Service interfaces", () => {
	describe("isExternalService", () => {
		it("should return true for a service with registerRoutes method", () => {
			const service: ExternalService = {
				name: "@nullshot/agent/test-service",
				registerRoutes: () => {},
			}
			expect(isExternalService(service)).toBe(true)
		})

		it("should return false for a basic service without registerRoutes", () => {
			const service: Service = {
				name: "@nullshot/agent/basic-service",
			}
			expect(isExternalService(service)).toBe(false)
		})

		it("should return false if registerRoutes is not a function", () => {
			const service = {
				name: "@nullshot/agent/bad-service",
				registerRoutes: "not-a-function",
			} as unknown as Service
			expect(isExternalService(service)).toBe(false)
		})

		it("should return true for external service with initialize", () => {
			const service: ExternalService = {
				name: "@nullshot/agent/full-service",
				registerRoutes: () => {},
				initialize: async () => {},
			}
			expect(isExternalService(service)).toBe(true)
		})
	})

	describe("Service type conformance", () => {
		it("should allow creating a Service with name only", () => {
			const service: Service = {
				name: "@nullshot/agent/minimal",
			}
			expect(service.name).toBe("@nullshot/agent/minimal")
			expect(service.initialize).toBeUndefined()
		})

		it("should allow creating a Service with initialize", () => {
			let initialized = false
			const service: Service = {
				name: "@nullshot/agent/initializable",
				initialize: async () => {
					initialized = true
				},
			}
			expect(service.name).toBe("@nullshot/agent/initializable")
			expect(service.initialize).toBeDefined()
		})

		it("should allow creating an EventService with onEvent", () => {
			const events: Event[] = []
			const service: EventService = {
				name: "@nullshot/agent/event-service",
				onEvent: (event: Event) => {
					events.push(event)
				},
			}

			const testEvent: Event = {
				id: "evt-1",
				role: "user",
				content: "hello",
			}

			service.onEvent?.(testEvent)
			expect(events).toHaveLength(1)
			expect(events[0]).toEqual(testEvent)
		})

		it("should allow EventService without onEvent callback", () => {
			const service: EventService = {
				name: "@nullshot/agent/quiet-service",
			}
			expect(service.onEvent).toBeUndefined()
		})

		it("Event should support system field", () => {
			const event: Event = {
				id: "evt-2",
				role: "system",
				system: "You are a helpful assistant",
				content: "System prompt set",
			}
			expect(event.system).toBe("You are a helpful assistant")
			expect(event.role).toBe("system")
		})
	})
})
