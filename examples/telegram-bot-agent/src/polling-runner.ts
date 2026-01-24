/**
 * Standalone polling runner for local development
 * 
 * Run this instead of webhook mode for simple local testing
 * Usage: pnpm dev:polling
 * 
 * Like Python solutions - just run and it works!
 */

import { startPolling } from "./polling";
import { readFileSync } from "fs";
import { join } from "path";

// Simple KV mock for local development (partial implementation)
class MockKV {
	private storage = new Map<string, string>();

	async get(key: string): Promise<string | null> {
		return this.storage.get(key) || null;
	}

	async put(key: string, value: string, _options?: { expirationTtl?: number }): Promise<void> {
		this.storage.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.storage.delete(key);
	}

	async list(): Promise<{ keys: Array<{ name: string }> }> {
		return { keys: Array.from(this.storage.keys()).map(k => ({ name: k })) };
	}

	// Stub methods for KVNamespace interface
	async getWithMetadata(): Promise<null> {
		return null;
	}
}

// Load .dev.vars file
function loadDevVars(): Record<string, string> {
	try {
		const devVarsPath = join(process.cwd(), ".dev.vars");
		const content = readFileSync(devVarsPath, "utf-8");
		const vars: Record<string, string> = {};

		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			// Skip comments and empty lines
			if (!trimmed || trimmed.startsWith("#")) continue;

			const match = trimmed.match(/^([^=]+)=(.*)$/);
			if (match) {
				const key = match[1].trim();
				const value = match[2].trim();
				vars[key] = value;
			}
		}

		return vars;
	} catch (error) {
		console.warn("⚠️ Could not load .dev.vars, using environment variables");
		return {};
	}
}

// Load environment
const devVars = loadDevVars();
const env = {
	TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || devVars.TELEGRAM_BOT_TOKEN || "",
	AGENT_URL: process.env.AGENT_URL || devVars.AGENT_URL || "http://localhost:8787",
	SESSIONS: new MockKV() as unknown as KVNamespace,
};

if (!env.TELEGRAM_BOT_TOKEN) {
	console.error("❌ TELEGRAM_BOT_TOKEN not found in environment");
	console.error("Please set it in .dev.vars or as environment variable");
	process.exit(1);
}

console.log("🚀 Starting Telegram bot in polling mode...");
console.log(`📡 Agent URL: ${env.AGENT_URL}`);

startPolling(env).catch((error) => {
	console.error("❌ Failed to start bot:", error);
	process.exit(1);
});
