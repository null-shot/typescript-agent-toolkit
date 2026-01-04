import { Agent, AgentHealthStatus } from "@/lib/config";
import { testAgentConnection } from "@/lib/agent-storage";

/**
 * Utility functions for agent management and operations
 * These functions provide common operations that can be used independently of the React context
 */

/**
 * Find an agent by ID
 */
export function findAgentById(
  agents: Agent[],
  agentId: string,
): Agent | undefined {
  return agents.find((agent) => agent.id === agentId);
}

/**
 * Find an agent by URL
 */
export function findAgentByUrl(
  agents: Agent[],
  url: string,
): Agent | undefined {
  return agents.find((agent) => agent.url === url);
}

/**
 * Get the first online agent
 */
export function getFirstOnlineAgent(agents: Agent[]): Agent | undefined {
  return agents.find((agent) => agent.health?.isOnline);
}

/**
 * Filter agents by online status
 */
export function filterAgentsByStatus(
  agents: Agent[],
  isOnline: boolean,
): Agent[] {
  return agents.filter((agent) => agent.health?.isOnline === isOnline);
}

/**
 * Sort agents by health status (online first, then by last checked)
 */
export function sortAgentsByHealth(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    // Online agents first
    if (a.health?.isOnline && !b.health?.isOnline) return -1;
    if (!a.health?.isOnline && b.health?.isOnline) return 1;

    // Then by last checked (newer first)
    const aChecked = a.lastChecked || 0;
    const bChecked = b.lastChecked || 0;
    return bChecked - aChecked;
  });
}

/**
 * Generate a unique agent ID
 */
export function generateAgentId(prefix: string = "agent"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Check if an agent is healthy (online and recently checked)
 */
export function isAgentHealthy(
  agent: Agent,
  maxAgeMs: number = 5 * 60 * 1000,
): boolean {
  if (!agent.health?.isOnline) return false;
  if (!agent.lastChecked) return false;

  const age = Date.now() - agent.lastChecked;
  return age <= maxAgeMs;
}

/**
 * Get agent health summary
 */
export function getAgentHealthSummary(agents: Agent[]): {
  total: number;
  online: number;
  offline: number;
  healthy: number;
} {
  const online = agents.filter((agent) => agent.health?.isOnline).length;
  const healthy = agents.filter((agent) => isAgentHealthy(agent)).length;

  return {
    total: agents.length,
    online,
    offline: agents.length - online,
    healthy,
  };
}

/**
 * Refresh health status for a single agent
 */
export async function refreshAgentHealth(
  agent: Agent,
): Promise<AgentHealthStatus> {
  try {
    const { isOnline, error } = await testAgentConnection(agent.url);
    return {
      isOnline,
      lastChecked: Date.now(),
      error,
    };
  } catch (error) {
    return {
      isOnline: false,
      lastChecked: Date.now(),
      error: error instanceof Error ? error.message : "Health check failed",
    };
  }
}

/**
 * Refresh health status for multiple agents
 */
export async function refreshMultipleAgentsHealth(
  agents: Agent[],
): Promise<Map<string, AgentHealthStatus>> {
  const healthMap = new Map<string, AgentHealthStatus>();

  // Refresh all agents in parallel
  const healthChecks = await Promise.allSettled(
    agents.map(async (agent) => ({
      id: agent.id,
      health: await refreshAgentHealth(agent),
    })),
  );

  // Process results
  healthChecks.forEach((result) => {
    if (result.status === "fulfilled") {
      healthMap.set(result.value.id, result.value.health);
    }
  });

  return healthMap;
}

/**
 * Create a default agent configuration
 */
export function createDefaultAgent(overrides: Partial<Agent> = {}): Agent {
  // Get default values from environment or use fallbacks
  const defaultUrl = typeof window !== "undefined" 
    ? (process.env.NEXT_PUBLIC_DEFAULT_AGENT_URL || "http://localhost:8787")
    : (process.env.NEXT_PUBLIC_DEFAULT_AGENT_URL || "http://localhost:8787");
  
  const defaultName = typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_DEFAULT_AGENT_NAME || "Default Agent")
    : (process.env.NEXT_PUBLIC_DEFAULT_AGENT_NAME || "Default Agent");
  
  return {
    id: generateAgentId("default"),
    name: defaultName,
    url: defaultUrl,
    health: {
      isOnline: false,
      lastChecked: 0,
    },
    ...overrides,
  };
}

/**
 * Validate agent configuration
 */
export function validateAgent(agent: Partial<Agent>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!agent.id) {
    errors.push("Agent ID is required");
  }

  if (!agent.name || agent.name.trim().length === 0) {
    errors.push("Agent name is required");
  }

  if (!agent.url) {
    errors.push("Agent URL is required");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Merge agent configurations (useful for updates)
 */
export function mergeAgentConfigs(base: Agent, updates: Partial<Agent>): Agent {
  return {
    ...base,
    ...updates,
    // Preserve health if not explicitly updated
    health: updates.health !== undefined ? updates.health : base.health,
    lastChecked:
      updates.lastChecked !== undefined
        ? updates.lastChecked
        : base.lastChecked,
  };
}

/**
 * Export agents to JSON (for backup or migration)
 */
export function exportAgentsToJson(agents: Agent[]): string {
  return JSON.stringify(agents, null, 2);
}

/**
 * Import agents from JSON (for restore or migration)
 */
export function importAgentsFromJson(jsonString: string): Agent[] {
  try {
    const parsed = JSON.parse(jsonString) as Agent[];

    // Validate each agent
    return parsed.filter((agent) => {
      const { isValid } = validateAgent(agent);
      return isValid;
    });
  } catch {
    throw new Error("Invalid JSON format for agents import");
  }
}

/**
 * Get recommended agents (common configurations)
 */
export function getRecommendedAgents(): Agent[] {
  return [
    createDefaultAgent({
      id: "local-default",
      name: "Local Development",
      url: "http://localhost:8787",
    }),
    createDefaultAgent({
      id: "cloudflare-default",
      name: "Cloudflare Workers",
      url: "https://your-worker.your-subdomain.workers.dev",
    }),
    createDefaultAgent({
      id: "docker-default",
      name: "Docker Container",
      url: "http://localhost:3000",
    }),
  ];
}

