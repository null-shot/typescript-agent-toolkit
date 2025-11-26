// Agent type definition and basic agent management

export interface Agent {
  id: string;
  name: string;
  url: string;
  health?: AgentHealthStatus;
  lastChecked?: number;
}

export interface AgentHealthStatus {
  isOnline: boolean;
  lastChecked: number; // timestamp
  responseTime?: number; // in milliseconds
  error?: string;
}

// Default agent for initial setup
export const DEFAULT_AGENT: Agent = {
  id: "default",
  name: "Default Agent",
  url: "http://localhost:8787",
  health: {
    isOnline: false,
    lastChecked: 0,
  },
};

// Get all available agents
// This function now supports both the old hardcoded approach and the new context-based approach
export function getAllAgents(contextAware: boolean = false): Agent[] {
  // For backward compatibility, return the default agent when not context-aware
  if (!contextAware) {
    return [DEFAULT_AGENT];
  }

  // Context-aware mode - this will be handled by the React context
  // Components using the context should use the useAgentContext hook instead
  // This is here for backward compatibility during the transition
  return [DEFAULT_AGENT];
}

// New function to get agents from localStorage (for use outside React components)
export function getAgentsFromStorage(): Agent[] {
  try {
    if (typeof window === "undefined") {
      // Server-side - return default agent
      return [DEFAULT_AGENT];
    }

    const stored = localStorage.getItem("agents");
    if (stored) {
      const parsedAgents = JSON.parse(stored) as Agent[];
      return parsedAgents.length > 0 ? parsedAgents : [DEFAULT_AGENT];
    }
  } catch (error) {
    console.error("Failed to load agents from localStorage:", error);
  }

  return [DEFAULT_AGENT];
}

// Save agents to localStorage (for use outside React components)
export function saveAgentsToStorage(agents: Agent[]): void {
  try {
    if (typeof window === "undefined") {
      // Server-side - do nothing
      return;
    }

    localStorage.setItem("agents", JSON.stringify(agents));
  } catch (error) {
    console.error("Failed to save agents to localStorage:", error);
  }
}
