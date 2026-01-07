import React, { ReactNode } from "react"
import { AgentProvider, AgentProviderProps } from "@/lib/agent-context"
import { Agent } from "@/lib/config"
import { getRecommendedAgents } from "@/lib/agent-utils"

/**
 * Configuration interface for setting up the agent management system
 * This provides a simple, declarative way to configure agents in your application
 */

// Main configuration interface
export interface AgentConfig {
  /** Initial agents to load */
  agents?: Agent[]
  /** Whether to persist agents to localStorage */
  persistToLocalStorage?: boolean
  /** Whether to load recommended agents if no agents are configured */
  useRecommendedAgents?: boolean
  /** Custom agent provider props */
  providerProps?: Partial<AgentProviderProps>
}

// Props for the main configuration component
export interface AgentConfigProviderProps extends AgentConfig {
  children: ReactNode
}

/**
 * Main configuration component that sets up the agent management system
 * This is the recommended way to configure agents in your application
 */
export function AgentConfigProvider({
  children,
  agents,
  persistToLocalStorage = true,
  useRecommendedAgents = true,
  providerProps = {},
}: AgentConfigProviderProps) {
  // Determine which agents to use
  let initialAgents: Agent[]
  
  if (agents && agents.length > 0) {
    // Use provided agents
    initialAgents = agents
  } else if (useRecommendedAgents) {
    // Use recommended agents
    initialAgents = getRecommendedAgents()
  } else {
    // Use default agent only
    initialAgents = []
  }

  return (
    <AgentProvider
      initialAgents={initialAgents}
      persistToLocalStorage={persistToLocalStorage}
      {...providerProps}
    >
      {children}
    </AgentProvider>
  )
}

/**
 * Pre-configured agent setups for common scenarios
 */

// Development environment configuration
export function DevelopmentAgentConfig({ children }: { children: ReactNode }) {
  return (
    <AgentConfigProvider
      agents={[
        {
          id: "dev-local",
          name: "Local Development",
          url: "http://localhost:8787",
        },
        {
          id: "dev-docker",
          name: "Docker Development",
          url: "http://localhost:3000",
        },
      ]}
      persistToLocalStorage={true}
      useRecommendedAgents={false}
    >
      {children}
    </AgentConfigProvider>
  )
}

// Production environment configuration
export function ProductionAgentConfig({ children }: { children: ReactNode }) {
  return (
    <AgentConfigProvider
      agents={[
        {
          id: "prod-primary",
          name: "Primary Agent",
          url: "https://your-agent.your-domain.com",
        },
        {
          id: "prod-backup",
          name: "Backup Agent",
          url: "https://backup-agent.your-domain.com",
        },
      ]}
      persistToLocalStorage={true}
      useRecommendedAgents={false}
    >
      {children}
    </AgentConfigProvider>
  )
}

// Minimal configuration (just the default agent)
export function MinimalAgentConfig({ children }: { children: ReactNode }) {
  return (
    <AgentConfigProvider
      agents={[]}
      persistToLocalStorage={false}
      useRecommendedAgents={false}
    >
      {children}
    </AgentConfigProvider>
  )
}

// Configuration with only recommended agents
export function RecommendedAgentConfig({ children }: { children: ReactNode }) {
  return (
    <AgentConfigProvider
      persistToLocalStorage={true}
      useRecommendedAgents={true}
    >
      {children}
    </AgentConfigProvider>
  )
}

// Testing configuration (no persistence)
export function TestingAgentConfig({ children }: { children: ReactNode }) {
  return (
    <AgentConfigProvider
      agents={[
        {
          id: "test-agent",
          name: "Test Agent",
          url: "http://localhost:9999",
        },
      ]}
      persistToLocalStorage={false}
      useRecommendedAgents={false}
    >
      {children}
    </AgentConfigProvider>
  )
}

/**
 * Hook for accessing agent configuration
 * This can be used to get configuration values in components
 */
export function useAgentConfig() {
  // For now, this just returns default values
  // In the future, this could read from a configuration context or settings
  return {
    maxAgents: 10,
    healthCheckInterval: 30000, // 30 seconds
    connectionTimeout: 5000, // 5 seconds
    enableAutoRefresh: true,
    enableNotifications: true,
  }
}

/**
 * Utility functions for configuration management
 */

// Create a configuration from environment variables
export function createConfigFromEnv(): AgentConfig {
  const envAgents = process.env.NEXT_PUBLIC_AGENTS
    ? JSON.parse(process.env.NEXT_PUBLIC_AGENTS)
    : undefined

  return {
    agents: envAgents,
    persistToLocalStorage: process.env.NEXT_PUBLIC_PERSIST_AGENTS !== "false",
    useRecommendedAgents: process.env.NEXT_PUBLIC_USE_RECOMMENDED_AGENTS !== "false",
  }
}

// Validate configuration
export function validateAgentConfig(config: AgentConfig): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (config.agents && !Array.isArray(config.agents)) {
    errors.push("Agents must be an array")
  }

  if (config.agents) {
    config.agents.forEach((agent, index) => {
      if (!agent.id) {
        errors.push(`Agent at index ${index} is missing an ID`)
      }
      if (!agent.name) {
        errors.push(`Agent at index ${index} is missing a name`)
      }
      if (!agent.url) {
        errors.push(`Agent at index ${index} is missing a URL`)
      }
    })
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}