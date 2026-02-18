import { describe, it, expect } from "vitest"
import {
	getPostGenerationPrompt,
	getQuickGenerationPrompt,
	detectLanguage,
	type PostStyle,
} from "./post-styles"

describe("Posting — Post Generation", () => {
	describe("getPostGenerationPrompt", () => {
		it("generates prompt for news style", () => {
			const prompt = getPostGenerationPrompt({
				topic: "New product release",
				style: "news",
				language: "en",
			})
			expect(prompt).toContain("New product release")
			expect(prompt).toContain("news")
			expect(prompt).toContain("English")
		})

		it("generates prompt for promo style", () => {
			const prompt = getPostGenerationPrompt({
				topic: "Black Friday sale",
				style: "promo",
				language: "en",
			})
			expect(prompt).toContain("Black Friday sale")
			expect(prompt).toContain("promo")
		})

		it("generates prompt in Russian", () => {
			const prompt = getPostGenerationPrompt({
				topic: "Запуск нового продукта",
				style: "announcement",
				language: "ru",
			})
			expect(prompt).toContain("Russian")
			expect(prompt).toContain("Запуск нового продукта")
		})

		it("respects maxLength option", () => {
			const prompt = getPostGenerationPrompt({
				topic: "Test",
				style: "casual",
				language: "en",
				maxLength: 500,
			})
			expect(prompt).toContain("500")
		})

		it("respects emoji option", () => {
			const promptWithEmoji = getPostGenerationPrompt({
				topic: "Test",
				style: "casual",
				language: "en",
				includeEmoji: true,
			})
			expect(promptWithEmoji).toContain("Include relevant emojis")

			const promptNoEmoji = getPostGenerationPrompt({
				topic: "Test",
				style: "casual",
				language: "en",
				includeEmoji: false,
			})
			expect(promptNoEmoji).toContain("Do not use emojis")
		})

		it("respects hashtags option", () => {
			const promptWithTags = getPostGenerationPrompt({
				topic: "Test",
				style: "casual",
				language: "en",
				includeHashtags: true,
			})
			expect(promptWithTags).toContain("hashtags")

			const promptNoTags = getPostGenerationPrompt({
				topic: "Test",
				style: "casual",
				language: "en",
				includeHashtags: false,
			})
			expect(promptNoTags).toContain("Do not include hashtags")
		})

		it("includes channel context when provided", () => {
			const prompt = getPostGenerationPrompt({
				topic: "Test",
				style: "news",
				language: "en",
				channelContext: "Tech news about AI and machine learning",
			})
			expect(prompt).toContain("Tech news about AI and machine learning")
		})

		it("generates valid prompt for all styles", () => {
			const styles: PostStyle[] = ["news", "promo", "casual", "announcement", "educational"]
			for (const style of styles) {
				const prompt = getPostGenerationPrompt({
					topic: "Test topic",
					style,
					language: "en",
				})
				expect(prompt).toBeTruthy()
				expect(prompt.length).toBeGreaterThan(100)
			}
		})
	})

	describe("getQuickGenerationPrompt", () => {
		it("generates a quick prompt with topic", () => {
			const prompt = getQuickGenerationPrompt("AI in healthcare", "en")
			expect(prompt).toContain("AI in healthcare")
		})

		it("generates in Russian when specified", () => {
			const prompt = getQuickGenerationPrompt("ИИ в медицине", "ru")
			expect(prompt).toContain("ИИ в медицине")
		})
	})

	describe("detectLanguage", () => {
		it("detects Russian text", () => {
			expect(detectLanguage("Привет, как дела?")).toBe("ru")
			expect(detectLanguage("Новости технологий")).toBe("ru")
		})

		it("detects English text", () => {
			expect(detectLanguage("Hello, how are you?")).toBe("en")
			expect(detectLanguage("Technology news")).toBe("en")
		})

		it("defaults to English for mixed/ambiguous text", () => {
			expect(detectLanguage("OK")).toBe("en")
			expect(detectLanguage("123 456")).toBe("en")
		})
	})
})
