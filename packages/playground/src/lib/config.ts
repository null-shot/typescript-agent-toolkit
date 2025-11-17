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

// Get all available agents (for now just returns default agent)
export function getAllAgents(): Agent[] {
  // In a more complete implementation, this would also fetch custom agents
  // from localStorage or other storage mechanisms
  return [DEFAULT_AGENT];
}

