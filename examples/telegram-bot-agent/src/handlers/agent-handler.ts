import { Bot, InlineKeyboard, Context } from "grammy"
import { Agent, parseAgentsFromEnv, getDefaultAgents, findAgentById } from "../types/agent"
import { setSelectedAgent, getSelectedAgentId, getOrCreateSessionData } from "../utils/session"

interface Env {
	TELEGRAM_BOT_TOKEN: string
	AGENT_URL: string
	AGENTS?: string // Format: "name1|url1,name2|url2"
	SESSIONS: KVNamespace
	AGENT_SERVICE?: Fetcher  // Service binding to agent (preferred over HTTP)
}

/**
 * Get list of available agents from environment
 */
export function getAvailableAgents(env: Env): Agent[] {
	// Try to parse from AGENTS env var first
	const parsedAgents = parseAgentsFromEnv(env.AGENTS)

	if (parsedAgents.length > 0) {
		return parsedAgents
	}

	// Fallback to default agent
	return getDefaultAgents(env.AGENT_URL)
}

/**
 * Setup agent selection handlers
 */
export function setupAgentHandlers(bot: Bot, env: Env): void {
	const agents = getAvailableAgents(env)

	// /agent command - show agent selection
	bot.command("agent", async (ctx) => {
		await showAgentSelection(ctx, env, agents)
	})

	// /agents command - alias for /agent
	bot.command("agents", async (ctx) => {
		await showAgentSelection(ctx, env, agents)
	})

	// Handle callback queries for agent selection
	bot.callbackQuery(/^select_agent:(.+)$/, async (ctx) => {
		const agentId = ctx.match[1]
		const agent = findAgentById(agents, agentId)

		if (!agent) {
			await ctx.answerCallbackQuery({
				text: "❌ Agent not found",
				show_alert: true,
			})
			return
		}

		const chatId = ctx.chat?.id
		if (!chatId) {
			await ctx.answerCallbackQuery({
				text: "❌ Chat not found",
				show_alert: true,
			})
			return
		}

		// Get current session to check if agent changed
		const currentAgentId = await getSelectedAgentId(env.SESSIONS, chatId.toString())
		const agentChanged = currentAgentId !== agentId

		// Update selected agent (keeps same session - history is shared across agents)
		await setSelectedAgent(
			env.SESSIONS,
			chatId.toString(),
			agent.id,
			agent.url
		)

		// Note: We no longer clear history when switching agents!
		// History is shared and messages are marked with which agent sent them.
		// This allows the new agent to see previous conversation context.

		// Answer callback
		await ctx.answerCallbackQuery({
			text: `✅ Switched to ${agent.name}`,
		})

		// Update message with new selection
		const keyboard = createAgentKeyboard(agents, agent.id)
		const text = formatAgentListMessage(agents, agent.id)

		try {
			await ctx.editMessageText(text, {
				reply_markup: keyboard,
				parse_mode: "HTML",
			})
		} catch (error) {
			// Message might be the same, ignore error
			console.log("Could not edit message:", error)
		}

		// Send confirmation
		const confirmMessage = agentChanged
			? `🔄 Switched to <b>${agent.name}</b>\n\n💬 New agent can see previous conversation history and will continue helping you.`
			: `✅ Already using <b>${agent.name}</b>`

		await ctx.reply(confirmMessage, { parse_mode: "HTML" })
	})
}

/**
 * Show agent selection menu
 */
async function showAgentSelection(ctx: Context, env: Env, agents: Agent[]): Promise<void> {
	const chatId = ctx.chat?.id
	if (!chatId) return

	// Get currently selected agent
	const currentAgentId = await getSelectedAgentId(env.SESSIONS, chatId.toString())

	const keyboard = createAgentKeyboard(agents, currentAgentId)
	const text = formatAgentListMessage(agents, currentAgentId)

	await ctx.reply(text, {
		reply_markup: keyboard,
		parse_mode: "HTML",
	})
}

/**
 * Create inline keyboard for agent selection
 */
function createAgentKeyboard(agents: Agent[], selectedAgentId?: string): InlineKeyboard {
	const keyboard = new InlineKeyboard()

	for (const agent of agents) {
		const isSelected = agent.id === selectedAgentId
		const label = isSelected ? `✅ ${agent.name}` : agent.name

		keyboard.text(label, `select_agent:${agent.id}`).row()
	}

	return keyboard
}

/**
 * Format agent list message
 */
function formatAgentListMessage(agents: Agent[], selectedAgentId?: string): string {
	let message = "🤖 <b>Select AI Agent</b>\n\n"

	for (const agent of agents) {
		const isSelected = agent.id === selectedAgentId
		const indicator = isSelected ? "✅" : "○"
		const name = isSelected ? `<b>${agent.name}</b>` : agent.name

		message += `${indicator} ${name}\n`

		if (agent.description) {
			message += `   <i>${agent.description}</i>\n`
		}

		message += "\n"
	}

	if (selectedAgentId) {
		const selected = findAgentById(agents, selectedAgentId)
		if (selected) {
			message += `\n📍 Current: <b>${selected.name}</b>`
		}
	} else {
		message += "\n💡 Select an agent to start chatting"
	}

	return message
}

/**
 * Get current agent URL for a chat
 * Returns default agent URL if no agent selected
 */
export async function getCurrentAgentUrl(env: Env, chatId: string): Promise<string> {
	const sessionData = await getOrCreateSessionData(env.SESSIONS, chatId)

	if (sessionData.selectedAgentUrl) {
		return sessionData.selectedAgentUrl
	}

	// Return default agent URL
	return env.AGENT_URL
}

/**
 * Get current agent name for a chat
 */
export async function getCurrentAgentName(env: Env, chatId: string): Promise<string> {
	const sessionData = await getOrCreateSessionData(env.SESSIONS, chatId)
	const agents = getAvailableAgents(env)

	if (sessionData.selectedAgentId) {
		const agent = findAgentById(agents, sessionData.selectedAgentId)
		if (agent) {
			return agent.name
		}
	}

	// Return default agent name
	const defaultAgents = getDefaultAgents(env.AGENT_URL)
	return defaultAgents[0]?.name || "AI Agent"
}

/**
 * Get current agent ID for a chat
 */
export async function getCurrentAgentId(env: Env, chatId: string): Promise<string> {
	const sessionData = await getOrCreateSessionData(env.SESSIONS, chatId)
	const agents = getAvailableAgents(env)

	if (sessionData.selectedAgentId) {
		return sessionData.selectedAgentId
	}

	// Return default agent ID
	const defaultAgents = getDefaultAgents(env.AGENT_URL)
	return defaultAgents[0]?.id || "default-agent"
}
