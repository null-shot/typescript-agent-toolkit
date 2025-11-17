// Agent health monitoring service

import { Agent, AgentHealthStatus } from "@/lib/config";
import { testAgentConnection } from "@/lib/agent-storage";

// Cache for health check results to prevent excessive requests
const healthCheckCache = new Map<string, { status: AgentHealthStatus; timestamp: number }>();

// Cache timeout in milliseconds (5 minutes)
const CACHE_TIMEOUT = 5 * 60 * 1000;

/**
 * Check if a cached health status is still valid
 */
function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < CACHE_TIMEOUT;
}

/**
 * Get cached health status for an agent
 */
function getCachedHealth(agentUrl: string): AgentHealthStatus | null {
  const cached = healthCheckCache.get(agentUrl);
  if (cached && isCacheValid(cached.timestamp)) {
    return cached.status;
  }
  return null;
}

/**
 * Update cached health status for an agent
 */
function setCachedHealth(agentUrl: string, status: AgentHealthStatus): void {
  healthCheckCache.set(agentUrl, {
    status,
    timestamp: Date.now(),
  });
}

/**
 * Check the health of a single agent
 * 
 * @param agent - The agent to check
 * @param force - Skip cache and force a new check
 * @returns Updated agent with health status
 */
export async function checkAgentHealth(agent: Agent, force: boolean = false): Promise<Agent> {
  // Return cached status if available and not forced
  if (!force) {
    const cached = getCachedHealth(agent.url);
    if (cached) {
      return {
        ...agent,
        health: cached,
        lastChecked: cached.lastChecked,
      };
    }
  }

  const startTime = Date.now();
  
  try {
    const result = await testAgentConnection(agent.url);
    const responseTime = Date.now() - startTime;
    
    const healthStatus: AgentHealthStatus = {
      isOnline: result.isOnline,
      lastChecked: Date.now(),
      responseTime,
      error: result.error,
    };
    
    setCachedHealth(agent.url, healthStatus);
    
    return {
      ...agent,
      health: healthStatus,
      lastChecked: healthStatus.lastChecked,
    };
  } catch (error) {
    const healthStatus: AgentHealthStatus = {
      isOnline: false,
      lastChecked: Date.now(),
      error: error instanceof Error ? error.message : "Unknown error",
    };
    
    setCachedHealth(agent.url, healthStatus);
    
    return {
      ...agent,
      health: healthStatus,
      lastChecked: healthStatus.lastChecked,
    };
  }
}

/**
 * Check the health of multiple agents
 * 
 * @param agents - Array of agents to check
 * @param force - Skip cache and force new checks
 * @returns Array of agents with updated health status
 */
export async function checkAgentsHealth(agents: Agent[], force: boolean = false): Promise<Agent[]> {
  // Run health checks in parallel for better performance
  const healthChecks = agents.map(agent => checkAgentHealth(agent, force));
  return Promise.all(healthChecks);
}

/**
 * Get a human-readable status message for an agent's health
 * 
 * @param agent - The agent to get status for
 * @returns Status message string
 */
export function getAgentStatusMessage(agent: Agent): string {
  if (!agent.health) {
    return "Unknown";
  }
  
  if (!agent.health.isOnline) {
    return agent.health.error || "Offline";
  }
  
  if (agent.health.responseTime) {
    return `Online (${agent.health.responseTime}ms)`;
  }
  
  return "Online";
}

/**
 * Get status color for an agent based on health
 * 
 * @param agent - The agent to get color for
 * @returns Color string for UI
 */
export function getAgentStatusColor(agent: Agent): "green" | "red" | "yellow" | "gray" {
  if (!agent.health) {
    return "gray";
  }
  
  if (!agent.health.isOnline) {
    return "red";
  }
  
  if (agent.health.responseTime && agent.health.responseTime > 2000) {
    return "yellow";
  }
  
  return "green";
}