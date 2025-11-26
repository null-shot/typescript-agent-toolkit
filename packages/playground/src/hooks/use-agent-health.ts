// React hook for agent health monitoring

import { useState, useEffect, useCallback } from "react";
import { Agent } from "@/lib/config";
import { checkAgentHealth, checkAgentsHealth } from "@/lib/agent-health";

/**
 * Hook for monitoring the health of a single agent
 * 
 * @param agent - The agent to monitor
 * @param interval - Health check interval in milliseconds (0 to disable auto-check)
 * @returns Object with health status and control functions
 */
export function useAgentHealth(agent: Agent, interval: number = 30000) {
  const [health, setHealth] = useState<Agent>(agent);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Manually trigger a health check
   */
  const checkHealth = useCallback(async (force: boolean = true) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const updatedAgent = await checkAgentHealth(agent, force);
      setHealth(updatedAgent);
      return updatedAgent;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to check agent health";
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [agent]);

  // Set up periodic health checks
  useEffect(() => {
    if (interval <= 0) return;

    // Check immediately on mount
    checkHealth(false);

    const intervalId = setInterval(() => {
      checkHealth(false);
    }, interval);

    return () => clearInterval(intervalId);
  }, [checkHealth, interval]);

  return {
    health,
    isLoading,
    error,
    checkHealth,
  };
}

/**
 * Hook for monitoring the health of multiple agents
 * 
 * @param agents - Array of agents to monitor
 * @param interval - Health check interval in milliseconds (0 to disable auto-check)
 * @returns Object with health status and control functions
 */
export function useAgentsHealth(agents: Agent[], interval: number = 30000) {
  const [health, setHealth] = useState<Agent[]>(agents);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Manually trigger health checks for all agents
   */
  const checkHealth = useCallback(async (force: boolean = true) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const updatedAgents = await checkAgentsHealth(agents, force);
      setHealth(updatedAgents);
      return updatedAgents;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to check agents health";
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [agents]);

  // Set up periodic health checks
  useEffect(() => {
    if (interval <= 0) return;

    // Check immediately on mount
    checkHealth(false);

    const intervalId = setInterval(() => {
      checkHealth(false);
    }, interval);

    return () => clearInterval(intervalId);
  }, [checkHealth, interval]);

  return {
    health,
    isLoading,
    error,
    checkHealth,
  };
}