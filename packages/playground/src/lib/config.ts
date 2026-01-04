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

// Cache for runtime config (fetched from API)
let runtimeConfigCache: { name?: string; url?: string } | null = null;
let configFetchPromise: Promise<{ name: string; url: string }> | null = null;

// Fetch config from API route (client-side only)
async function fetchRuntimeConfig(): Promise<{ name: string; url: string }> {
	if (configFetchPromise) {
		return configFetchPromise;
	}

	configFetchPromise = (async () => {
		try {
			console.log("[Agent Config] Fetching runtime config from /api/config");
			const response = await fetch("/api/config");
			if (response.ok) {
				const data = (await response.json()) as { defaultAgentName: string; defaultAgentUrl: string };
				console.log("[Agent Config] Received config:", data);
				runtimeConfigCache = { name: data.defaultAgentName, url: data.defaultAgentUrl };
				return { name: data.defaultAgentName, url: data.defaultAgentUrl };
			} else {
				console.error("[Agent Config] API response not OK:", response.status, response.statusText);
			}
		} catch (error) {
			console.error("[Agent Config] Failed to fetch runtime config:", error);
		}
		// Fallback to env vars or defaults
		const name = process.env.NEXT_PUBLIC_DEFAULT_AGENT_NAME || "Default Agent";
		const url = process.env.NEXT_PUBLIC_DEFAULT_AGENT_URL || "http://localhost:8787";
		console.log("[Agent Config] Using fallback config:", { name, url });
		return { name, url };
	})();

	return configFetchPromise;
}

// Get default agent name - can be overridden at runtime
// In Next.js, NEXT_PUBLIC_ vars are available on both client and server
// They are embedded at build time, but in dev mode they can be read at runtime
export function getDefaultAgentName(): string {
	// Server-side: read from env directly
	if (typeof window === "undefined") {
		const envName = process.env.NEXT_PUBLIC_DEFAULT_AGENT_NAME;
		return (envName && envName.trim()) || "Default Agent";
	}

	// Client-side: try cached value first, then env, then fallback
	if (runtimeConfigCache?.name) {
		return runtimeConfigCache.name;
	}

	const envName = process.env.NEXT_PUBLIC_DEFAULT_AGENT_NAME;
	if (envName && envName.trim()) {
		return envName.trim();
	}

	return "Default Agent";
}

// Get default agent URL - can be overridden at runtime
export function getDefaultAgentUrl(): string {
	// Server-side: read from env directly
	if (typeof window === "undefined") {
		const envUrl = process.env.NEXT_PUBLIC_DEFAULT_AGENT_URL;
		return (envUrl && envUrl.trim()) || "http://localhost:8787";
	}

	// Client-side: try cached value first, then env, then fallback
	if (runtimeConfigCache?.url) {
		return runtimeConfigCache.url;
	}

	const envUrl = process.env.NEXT_PUBLIC_DEFAULT_AGENT_URL;
	if (envUrl && envUrl.trim()) {
		return envUrl.trim();
	}

	return "http://localhost:8787";
}

// Fetch and update runtime config (call this on client-side mount)
export async function loadRuntimeConfig(): Promise<void> {
	if (typeof window === "undefined") return;
	const config = await fetchRuntimeConfig();
	console.log("[Agent Config] Runtime config loaded:", config);
	// Force update cache
	runtimeConfigCache = config;
}

// Function to get default agent dynamically (reads env vars each time)
export function getDefaultAgent(): Agent {
  return {
    id: "default",
    name: getDefaultAgentName(),
    url: getDefaultAgentUrl(),
    health: {
      isOnline: false,
      lastChecked: 0,
    },
  };
}

// Default agent for initial setup (for backward compatibility)
// Note: This is created once, so it may not reflect runtime env changes
// Use getDefaultAgent() for dynamic reading
export const DEFAULT_AGENT: Agent = getDefaultAgent();

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
