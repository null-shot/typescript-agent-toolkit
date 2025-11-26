/**
 * Persistence layer for agent data
 * Provides utilities for saving/loading agents to/from localStorage
 * with proper error handling and fallback mechanisms
 */

import { Agent } from "@/lib/config";

// Storage keys
const STORAGE_KEYS = {
  AGENTS: "agents",
  SELECTED_AGENT: "selected-agent-id",
  AGENT_CONFIG: "agent-config",
} as const;

// Storage interface
export interface AgentStorage {
  saveAgents(agents: Agent[]): void;
  loadAgents(): Agent[];
  saveSelectedAgentId(agentId: string): void;
  loadSelectedAgentId(): string | null;
  clearAll(): void;
  isAvailable(): boolean;
}

// localStorage implementation
export class LocalStorageAgentStorage implements AgentStorage {
  private readonly storage: Storage | null;
  private readonly key: string;

  constructor(key: string = STORAGE_KEYS.AGENTS) {
    this.key = key;
    this.storage = typeof window !== "undefined" ? window.localStorage : null;
  }

  isAvailable(): boolean {
    try {
      if (!this.storage) return false;
      const testKey = "__agent_storage_test__";
      this.storage.setItem(testKey, "test");
      this.storage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  saveAgents(agents: Agent[]): void {
    if (!this.isAvailable()) return;

    try {
      const data = JSON.stringify(agents);
      this.storage!.setItem(this.key, data);
    } catch (error) {
      console.error("Failed to save agents to localStorage:", error);
      // Try to save a smaller version (without health data)
      try {
        const minimalAgents = agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          url: agent.url,
        }));
        const minimalData = JSON.stringify(minimalAgents);
        this.storage!.setItem(this.key, minimalData);
      } catch (fallbackError) {
        console.error("Failed to save minimal agents data:", fallbackError);
      }
    }
  }

  loadAgents(): Agent[] {
    if (!this.isAvailable()) return [];

    try {
      const data = this.storage!.getItem(this.key);
      if (!data) return [];

      const agents = JSON.parse(data) as Agent[];

      // Validate loaded agents
      if (!Array.isArray(agents)) return [];

      return agents.filter(
        (agent) =>
          agent &&
          typeof agent.id === "string" &&
          typeof agent.name === "string" &&
          typeof agent.url === "string",
      );
    } catch (error) {
      console.error("Failed to load agents from localStorage:", error);
      return [];
    }
  }

  saveSelectedAgentId(agentId: string): void {
    if (!this.isAvailable()) return;

    try {
      this.storage!.setItem(STORAGE_KEYS.SELECTED_AGENT, agentId);
    } catch (error) {
      console.error("Failed to save selected agent ID:", error);
    }
  }

  loadSelectedAgentId(): string | null {
    if (!this.isAvailable()) return null;

    try {
      return this.storage!.getItem(STORAGE_KEYS.SELECTED_AGENT);
    } catch (error) {
      console.error("Failed to load selected agent ID:", error);
      return null;
    }
  }

  clearAll(): void {
    if (!this.isAvailable()) return;

    try {
      this.storage!.removeItem(this.key);
      this.storage!.removeItem(STORAGE_KEYS.SELECTED_AGENT);
      this.storage!.removeItem(STORAGE_KEYS.AGENT_CONFIG);
    } catch (error) {
      console.error("Failed to clear agent storage:", error);
    }
  }
}

// Memory implementation (fallback when localStorage is not available)
export class MemoryAgentStorage implements AgentStorage {
  private agents: Agent[] = [];
  private selectedAgentId: string | null = null;

  isAvailable(): boolean {
    return true;
  }

  saveAgents(agents: Agent[]): void {
    this.agents = [...agents];
  }

  loadAgents(): Agent[] {
    return [...this.agents];
  }

  saveSelectedAgentId(agentId: string): void {
    this.selectedAgentId = agentId;
  }

  loadSelectedAgentId(): string | null {
    return this.selectedAgentId;
  }

  clearAll(): void {
    this.agents = [];
    this.selectedAgentId = null;
  }
}

// Factory function to create appropriate storage instance
export function createAgentStorage(): AgentStorage {
  const localStorage = new LocalStorageAgentStorage();
  if (localStorage.isAvailable()) {
    return localStorage;
  }
  return new MemoryAgentStorage();
}

// Default storage instance
export const defaultAgentStorage = createAgentStorage();

// Migration utilities
export class AgentStorageMigrator {
  constructor(private storage: AgentStorage) {}

  /**
   * Migrate from old format to new format
   * This can be extended as the data format evolves
   */
  migrate(): void {
    const agents = this.storage.loadAgents();

    // Add any migration logic here
    const migratedAgents = agents.map((agent) => {
      // Ensure all required fields are present
      if (!agent.health) {
        agent.health = {
          isOnline: false,
          lastChecked: 0,
        };
      }

      // Ensure lastChecked is a number
      if (typeof agent.lastChecked !== "number") {
        agent.lastChecked = 0;
      }

      return agent;
    });

    // Save migrated agents
    this.storage.saveAgents(migratedAgents);
  }

  /**
   * Export data for backup
   */
  exportData(): string {
    const agents = this.storage.loadAgents();
    const selectedId = this.storage.loadSelectedAgentId();

    return JSON.stringify(
      {
        version: "1.0",
        timestamp: new Date().toISOString(),
        agents,
        selectedAgentId: selectedId,
      },
      null,
      2,
    );
  }

  /**
   * Import data from backup
   */
  importData(data: string): boolean {
    try {
      const parsed = JSON.parse(data);

      if (parsed.agents && Array.isArray(parsed.agents)) {
        this.storage.saveAgents(parsed.agents);
      }

      if (
        parsed.selectedAgentId &&
        typeof parsed.selectedAgentId === "string"
      ) {
        this.storage.saveSelectedAgentId(parsed.selectedAgentId);
      }

      return true;
    } catch (error) {
      console.error("Failed to import agent data:", error);
      return false;
    }
  }
}

// Storage event handler (for cross-tab synchronization)
export function setupStorageSync(onStorageChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {}; // No-op on server
  }

  const handleStorageChange = (event: StorageEvent) => {
    if (event.key && event.key.includes("agent")) {
      onStorageChange();
    }
  };

  window.addEventListener("storage", handleStorageChange);

  return () => {
    window.removeEventListener("storage", handleStorageChange);
  };
}

