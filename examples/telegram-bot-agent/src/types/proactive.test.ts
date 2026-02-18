import { describe, it, expect } from "vitest"
import { isQuestion, matchesKeywords } from "./proactive"

describe("Support — Question Detection", () => {
	describe("isQuestion", () => {
		it("detects messages with question mark", () => {
			expect(isQuestion("How does this work?")).toBe(true)
			expect(isQuestion("Что это?")).toBe(true)
			expect(isQuestion("Really?")).toBe(true)
		})

		it("detects English question patterns", () => {
			expect(isQuestion("What is the best way to do this?")).toBe(true)
			expect(isQuestion("How can I configure the bot?")).toBe(true)
			expect(isQuestion("Where do I find the settings?")).toBe(true)
			expect(isQuestion("When will the update be released?")).toBe(true)
			expect(isQuestion("Why is this happening?")).toBe(true)
			expect(isQuestion("Who is responsible for this?")).toBe(true)
		})

		it("detects Russian question patterns", () => {
			expect(isQuestion("Как настроить бота")).toBe(true)
			expect(isQuestion("Где найти документацию")).toBe(true)
			expect(isQuestion("Почему не работает")).toBe(true)
			expect(isQuestion("Сколько стоит подписка")).toBe(true)
			expect(isQuestion("Кто отвечает за проект")).toBe(true)
		})

		it("detects help requests", () => {
			expect(isQuestion("Can someone help me with this issue")).toBe(true)
			expect(isQuestion("Please explain how authentication works")).toBe(true)
			expect(isQuestion("Tell me about the API")).toBe(true)
			expect(isQuestion("Подскажите как подключить webhook")).toBe(true)
			expect(isQuestion("Помогите разобраться с ошибкой")).toBe(true)
		})

		it("does NOT flag regular statements", () => {
			expect(isQuestion("I finished the task")).toBe(false)
			expect(isQuestion("The server is running fine")).toBe(false)
			expect(isQuestion("Thanks for the update")).toBe(false)
			expect(isQuestion("Всё работает отлично")).toBe(false)
			expect(isQuestion("OK")).toBe(false)
		})

		it("handles empty and short strings", () => {
			expect(isQuestion("")).toBe(false)
			expect(isQuestion("hi")).toBe(false)
			expect(isQuestion("ok")).toBe(false)
		})
	})

	describe("matchesKeywords", () => {
		it("matches exact keywords", () => {
			expect(matchesKeywords("I need help with billing", ["billing"])).toBe(true)
			expect(matchesKeywords("bug report: login broken", ["bug"])).toBe(true)
		})

		it("matches case-insensitively", () => {
			expect(matchesKeywords("URGENT issue!", ["urgent"])).toBe(true)
			expect(matchesKeywords("urgent issue!", ["URGENT"])).toBe(true)
		})

		it("matches partial words", () => {
			expect(matchesKeywords("I need technical support", ["support"])).toBe(true)
		})

		it("matches any of multiple keywords", () => {
			expect(matchesKeywords("payment failed", ["billing", "payment", "refund"])).toBe(true)
		})

		it("does NOT match when no keywords present", () => {
			expect(matchesKeywords("nice weather today", ["billing", "support"])).toBe(false)
		})

		it("returns false for empty keywords array", () => {
			expect(matchesKeywords("any text here", [])).toBe(false)
		})
	})
})
