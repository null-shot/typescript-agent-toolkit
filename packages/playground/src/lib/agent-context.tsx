"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  ReactNode,
} from "react";
import { Agent, AgentHealthStatus, DEFAULT_AGENT } from "@/lib/config";
import { saveCustomAgent, validateAgentUrl } from "@/lib/agent-storage";
import { createAgentStorage, setupStorageSync } from "@/lib/agent-persistence";

// Agent context state interface
export interface AgentContextState {
  agents: Agent[];
  selectedAgentId: string | null;
  isLoading: boolean;
  error: string | null;
}

// Agent context actions
type AgentContextAction =
  | { type: "SET_AGENTS"; payload: Agent[] }
  | { type: "ADD_AGENT"; payload: Agent }
  | { type: "REMOVE_AGENT"; payload: string } // agent id
  | {
      type: "UPDATE_AGENT_HEALTH";
      payload: { id: string; health: AgentHealthStatus };
    }
  | { type: "SELECT_AGENT"; payload: string }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "RESET_AGENTS" };

// Initial state
const initialState: AgentContextState = {
  agents: [DEFAULT_AGENT],
  selectedAgentId: DEFAULT_AGENT.id,
  isLoading: false,
  error: null,
};

// Agent reducer function
function agentReducer(
  state: AgentContextState,
  action: AgentContextAction,
): AgentContextState {
  switch (action.type) {
    case "SET_AGENTS":
      return {
        ...state,
        agents: action.payload,
        isLoading: false,
        error: null,
      };
    case "ADD_AGENT":
      return {
        ...state,
        agents: [...state.agents, action.payload],
        isLoading: false,
        error: null,
      };
    case "REMOVE_AGENT":
      const filteredAgents = state.agents.filter(
        (agent) => agent.id !== action.payload,
      );
      const newSelectedId =
        state.selectedAgentId === action.payload
          ? filteredAgents[0]?.id || null
          : state.selectedAgentId;
      return {
        ...state,
        agents: filteredAgents,
        selectedAgentId: newSelectedId,
        isLoading: false,
        error: null,
      };
    case "UPDATE_AGENT_HEALTH":
      return {
        ...state,
        agents: state.agents.map((agent) =>
          agent.id === action.payload.id
            ? {
                ...agent,
                health: action.payload.health,
                lastChecked: Date.now(),
              }
            : agent,
        ),
      };
    case "SELECT_AGENT":
      return {
        ...state,
        selectedAgentId: action.payload,
        error: null,
      };
    case "SET_LOADING":
      return {
        ...state,
        isLoading: action.payload,
      };
    case "SET_ERROR":
      return {
        ...state,
        error: action.payload,
        isLoading: false,
      };
    case "RESET_AGENTS":
      return {
        ...initialState,
      };
    default:
      return state;
  }
}

// Agent context type
interface AgentContextType extends AgentContextState {
  // Actions
  addAgent: (
    name: string,
    url: string,
  ) => Promise<{ success: boolean; error?: string }>;
  removeAgent: (agentId: string) => void;
  selectAgent: (agentId: string) => void;
  updateAgentHealth: (agentId: string, health: AgentHealthStatus) => void;
  refreshAgents: () => Promise<void>;
  setAgents: (agents: Agent[]) => void;
  resetAgents: () => void;
}

// Create the context
const AgentContext = createContext<AgentContextType | undefined>(undefined);

// Agent provider props
export interface AgentProviderProps {
  children: ReactNode;
  initialAgents?: Agent[];
  persistToLocalStorage?: boolean;
}

// Agent Provider component
export function AgentProvider({
  children,
  initialAgents,
  persistToLocalStorage = true,
}: AgentProviderProps) {
  const [state, dispatch] = useReducer(agentReducer, {
    ...initialState,
    agents: initialAgents || [DEFAULT_AGENT],
    selectedAgentId: initialAgents?.[0]?.id || DEFAULT_AGENT.id,
  });

  // Create storage instance
  const storage = React.useMemo(() => createAgentStorage(), []);

  // Load agents from storage on mount
  useEffect(() => {
    if (persistToLocalStorage) {
      loadAgentsFromStorage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistToLocalStorage, storage]);

  // Save agents to storage when they change
  useEffect(() => {
    if (persistToLocalStorage) {
      saveAgentsToStorage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.agents, persistToLocalStorage]);

  // Setup storage sync for cross-tab updates
  useEffect(() => {
    if (!persistToLocalStorage) return;

    const cleanup = setupStorageSync(() => {
      loadAgentsFromStorage();
    });

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistToLocalStorage]);

  // Load agents from storage
  const loadAgentsFromStorage = () => {
    try {
      const storedAgents = storage.loadAgents();
      if (storedAgents.length > 0) {
        dispatch({ type: "SET_AGENTS", payload: storedAgents });
      }
    } catch (error) {
      console.error("Failed to load agents from storage:", error);
      dispatch({ type: "SET_ERROR", payload: "Failed to load agents" });
    }
  };

  // Save agents to storage
  const saveAgentsToStorage = () => {
    try {
      storage.saveAgents(state.agents);
    } catch (error) {
      console.error("Failed to save agents to storage:", error);
    }
  };

  // Add a new agent
  const addAgent = async (
    name: string,
    url: string,
  ): Promise<{ success: boolean; error?: string }> => {
    // Validate URL
    const validation = validateAgentUrl(url);
    if (!validation.isValid) {
      return { success: false, error: validation.error };
    }

    // Check for duplicate URLs
    const existingAgent = state.agents.find((agent) => agent.url === url);
    if (existingAgent) {
      return { success: false, error: "An agent with this URL already exists" };
    }

    try {
      dispatch({ type: "SET_LOADING", payload: true });

      // Create and save the agent
      const newAgent = saveCustomAgent(name, url);

      // Test connection
      const { isOnline, error } = await import("@/lib/agent-storage").then(
        (module) => module.testAgentConnection(url),
      );

      const agentWithHealth: Agent = {
        ...newAgent,
        health: {
          isOnline,
          lastChecked: Date.now(),
          error,
        },
      };

      dispatch({ type: "ADD_AGENT", payload: agentWithHealth });

      // Auto-select the new agent if it's the first one or if it's online
      if (state.agents.length === 0 || isOnline) {
        dispatch({ type: "SELECT_AGENT", payload: agentWithHealth.id });
      }

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to add agent";
      dispatch({ type: "SET_ERROR", payload: errorMessage });
      return { success: false, error: errorMessage };
    }
  };

  // Remove an agent
  const removeAgent = (agentId: string) => {
    dispatch({ type: "REMOVE_AGENT", payload: agentId });
  };

  // Select an agent
  const selectAgent = (agentId: string) => {
    dispatch({ type: "SELECT_AGENT", payload: agentId });
  };

  // Update agent health status
  const updateAgentHealth = (agentId: string, health: AgentHealthStatus) => {
    dispatch({ type: "UPDATE_AGENT_HEALTH", payload: { id: agentId, health } });
  };

  // Refresh all agents (check their health)
  const refreshAgents = async () => {
    dispatch({ type: "SET_LOADING", payload: true });

    try {
      const { testAgentConnection } = await import("@/lib/agent-storage");

      // Check health for all agents
      const healthChecks = await Promise.all(
        state.agents.map(async (agent) => {
          const { isOnline, error } = await testAgentConnection(agent.url);
          return {
            id: agent.id,
            health: {
              isOnline,
              lastChecked: Date.now(),
              error,
            } as AgentHealthStatus,
          };
        }),
      );

      // Update health for all agents
      healthChecks.forEach(({ id, health }) => {
        updateAgentHealth(id, health);
      });
    } catch {
      dispatch({
        type: "SET_ERROR",
        payload: "Failed to refresh agent health",
      });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  // Set agents directly
  const setAgents = (agents: Agent[]) => {
    dispatch({ type: "SET_AGENTS", payload: agents });
  };

  // Reset to initial state
  const resetAgents = () => {
    dispatch({ type: "RESET_AGENTS" });
  };

  const contextValue: AgentContextType = {
    ...state,
    addAgent,
    removeAgent,
    selectAgent,
    updateAgentHealth,
    refreshAgents,
    setAgents,
    resetAgents,
  };

  return (
    <AgentContext.Provider value={contextValue}>
      {children}
    </AgentContext.Provider>
  );
}

// Custom hook to use the agent context
export function useAgentContext() {
  const context = useContext(AgentContext);
  if (context === undefined) {
    throw new Error("useAgentContext must be used within an AgentProvider");
  }
  return context;
}

// Hook for agent selection specifically
export function useAgentSelection() {
  const { agents, selectedAgentId, selectAgent } = useAgentContext();
  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) || null;

  return {
    agents,
    selectedAgent,
    selectedAgentId,
    selectAgent,
  };
}

// Hook for agent management (add/remove)
export function useAgentManagement() {
  const { addAgent, removeAgent, refreshAgents, isLoading, error } =
    useAgentContext();

  return {
    addAgent,
    removeAgent,
    refreshAgents,
    isLoading,
    error,
  };
}

