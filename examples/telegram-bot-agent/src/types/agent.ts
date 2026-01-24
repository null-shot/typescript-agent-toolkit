/**
 * Agent Types
 * 
 * Defines the structure for AI agents that can be selected in the bot
 */

export interface Agent {
	id: string
	name: string
	url: string
	description?: string
}

/**
 * Parse agents from environment variable
 * Format: "name1|url1,name2|url2,..."
 * 
 * Example: "Simple Agent|https://agent1.workers.dev,Queue Agent|https://agent2.workers.dev"
 */
export function parseAgentsFromEnv(envValue: string | undefined): Agent[] {
	if (!envValue || envValue.trim() === "") {
		return []
	}

	const agents: Agent[] = []
	const entries = envValue.split(",")

	for (const entry of entries) {
		const parts = entry.trim().split("|")
		if (parts.length >= 2) {
			const name = parts[0].trim()
			const url = parts[1].trim()
			const description = parts[2]?.trim()

			if (name && url) {
				agents.push({
					id: generateAgentId(name),
					name,
					url,
					description,
				})
			}
		}
	}

	return agents
}

/**
 * Generate a stable ID from agent name
 */
function generateAgentId(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
}

/**
 * Get default agents list
 * Used when AGENTS env var is not set
 */
export function getDefaultAgents(defaultAgentUrl: string): Agent[] {
	return [
		{
			id: "default",
			name: "Simple Prompt Agent",
			url: defaultAgentUrl,
			description: "Default AI assistant",
		},
	]
}

/**
 * Find agent by ID
 */
export function findAgentById(agents: Agent[], id: string): Agent | undefined {
	return agents.find((a) => a.id === id)
}

/**
 * Find agent by URL
 */
export function findAgentByUrl(agents: Agent[], url: string): Agent | undefined {
	return agents.find((a) => a.url === url)
}
