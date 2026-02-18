/**
 * Bot Profile Storage
 * Manages bot profile data in KV
 */

import type { BotProfile, BotRole } from "../types/bot-profile"
import { createDefaultProfile, getCombinedPrompt } from "../types/bot-profile"

const PROFILE_KEY = (chatId: number) => `bot_profile:${chatId}`

/**
 * Get bot profile for a chat
 */
export async function getBotProfile(
	kv: KVNamespace,
	chatId: number
): Promise<BotProfile | null> {
	const data = await kv.get(PROFILE_KEY(chatId))
	if (!data) return null
	return JSON.parse(data) as BotProfile
}

/**
 * Get or create bot profile
 */
export async function getOrCreateProfile(
	kv: KVNamespace,
	chatId: number,
	chatTitle: string
): Promise<BotProfile> {
	const existing = await getBotProfile(kv, chatId)
	if (existing) return existing

	const profile = createDefaultProfile(chatId, chatTitle)
	await saveBotProfile(kv, profile)
	return profile
}

/**
 * Save bot profile
 */
export async function saveBotProfile(
	kv: KVNamespace,
	profile: BotProfile
): Promise<void> {
	profile.updatedAt = Date.now()
	await kv.put(PROFILE_KEY(profile.chatId), JSON.stringify(profile))
}

/**
 * Add role to profile
 */
export async function addRole(
	kv: KVNamespace,
	chatId: number,
	role: BotRole
): Promise<BotProfile> {
	const profile = await getBotProfile(kv, chatId)
	if (!profile) {
		throw new Error("Profile not found")
	}

	if (!profile.roles.includes(role)) {
		profile.roles.push(role)
		await saveBotProfile(kv, profile)
	}

	return profile
}

/**
 * Remove role from profile
 */
export async function removeRole(
	kv: KVNamespace,
	chatId: number,
	role: BotRole
): Promise<BotProfile> {
	const profile = await getBotProfile(kv, chatId)
	if (!profile) {
		throw new Error("Profile not found")
	}

	profile.roles = profile.roles.filter((r) => r !== role)
	await saveBotProfile(kv, profile)

	return profile
}

/**
 * Set roles for profile (replace all)
 */
export async function setRoles(
	kv: KVNamespace,
	chatId: number,
	roles: BotRole[]
): Promise<BotProfile> {
	const profile = await getBotProfile(kv, chatId)
	if (!profile) {
		throw new Error("Profile not found")
	}

	profile.roles = [...new Set(roles)] // Dedupe
	await saveBotProfile(kv, profile)

	return profile
}

/**
 * Mark setup as complete
 */
export async function completeSetup(
	kv: KVNamespace,
	chatId: number
): Promise<BotProfile> {
	const profile = await getBotProfile(kv, chatId)
	if (!profile) {
		throw new Error("Profile not found")
	}

	profile.setupComplete = true
	await saveBotProfile(kv, profile)

	return profile
}

/**
 * Check if setup is complete
 */
export async function isSetupComplete(
	kv: KVNamespace,
	chatId: number
): Promise<boolean> {
	const profile = await getBotProfile(kv, chatId)
	return profile?.setupComplete ?? false
}

/**
 * Get combined prompt based on roles
 */
export async function getProfilePrompt(
	kv: KVNamespace,
	chatId: number
): Promise<string> {
	const profile = await getBotProfile(kv, chatId)
	if (!profile || profile.roles.length === 0) {
		return "You are a helpful assistant."
	}

	return getCombinedPrompt(profile.roles)
}

/**
 * Delete bot profile
 */
export async function deleteBotProfile(
	kv: KVNamespace,
	chatId: number
): Promise<void> {
	await kv.delete(PROFILE_KEY(chatId))
}
