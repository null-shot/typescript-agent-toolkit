// Agent storage utilities for custom agents

import { Agent } from "@/lib/config";

// CustomAgent extends Agent with additional properties if needed
export interface CustomAgent extends Agent {
  // For now, CustomAgent is the same as Agent
  // We can add additional properties here if needed in the future
  createdAt?: string; // Optional timestamp
}

// Validate agent URL format
export function validateAgentUrl(url: string): { isValid: boolean; error?: string } {
  if (!url) {
    return { isValid: false, error: "URL is required" };
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return { isValid: false, error: "URL must use http or https protocol" };
    }
    return { isValid: true };
  } catch {
    return { isValid: false, error: "Invalid URL format" };
  }
}

// Try to get agent metadata (name, version, etc.) from agent endpoint
export async function getAgentMetadata(url: string): Promise<{ name?: string; version?: string; [key: string]: unknown } | null> {
  try {
    // Try to get metadata from root endpoint (some agents expose this)
    const response = await fetch(`${url}/`, {
      method: "GET",
      signal: AbortSignal.timeout(3000), // 3 second timeout
      headers: {
        "Accept": "application/json",
      },
    });
    
    if (response.ok) {
      const data = await response.json() as Record<string, unknown>;
      // Check if response contains agent metadata
      if (data.name || data.agentName || data.service) {
        return {
          name: (data.name || data.agentName || data.service) as string,
          version: data.version as string | undefined,
          ...data,
        };
      }
    }
  } catch (error) {
    // Ignore errors - metadata endpoint is optional
    console.debug(`Could not fetch agent metadata from ${url}:`, error);
  }
  
  return null;
}

// Determine agent name from URL/port or metadata
export async function detectAgentName(url: string): Promise<string> {
  // First, try to get metadata from agent
  const metadata = await getAgentMetadata(url);
  if (metadata?.name) {
    return metadata.name;
  }
  
  // Fallback: determine name from URL/port
  try {
    const urlObj = new URL(url);
    const port = urlObj.port || (urlObj.protocol === "https:" ? "443" : "80");
    const hostname = urlObj.hostname;
    
    // Map common ports to agent names
    const portToName: Record<string, string> = {
      "8787": "Local Agent",
      "8788": "MCP Server",
      "3000": "Playground",
    };
    
    // Check if it's localhost with a known port
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return portToName[port] || "Local Agent";
    }
    
    // For remote URLs, use hostname as part of name
    return hostname.replace(/\.workers\.dev$/, "").replace(/\./g, " ") || "Remote Agent";
  } catch {
    return "Default Agent";
  }
}

// Test connection to agent endpoint
export async function testAgentConnection(url: string): Promise<{ isOnline: boolean; error?: string; metadata?: { name?: string } }> {
  try {
    // Ping the root endpoint expecting 404 (which means agent is alive)
    // Or any valid HTTP response (200, 404, etc.) means the server is running
    // Timeout set to 35 seconds to account for Durable Object initialization on first request
    const response = await fetch(`${url}/`, {
      method: "GET",
      signal: AbortSignal.timeout(35000), // 35 second timeout (accounts for DO initialization)
      // Don't throw on error status codes
      // We want to catch network errors, not HTTP status errors
    });
    
    // Agent is alive if we get any response (including 404)
    // 404 means the server is running but the route doesn't exist (which is expected)
    // Any HTTP response (even 404, 500, etc.) means the server is running
    // Only network errors (CORS, timeout, connection refused) mean offline
    console.log(`[testAgentConnection] Agent health check succeeded for ${url}, status: ${response.status}`);
    
    // Try to get metadata if response is OK (200)
    let metadata: { name?: string } | undefined;
    if (response.ok) {
      try {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await response.json() as Record<string, unknown>;
          if (data.name || data.agentName) {
            metadata = { name: (data.name || data.agentName) as string };
            console.log(`[testAgentConnection] Found metadata name: ${metadata.name}`);
          }
        }
      } catch (e) {
        // Ignore JSON parsing errors
        console.log(`[testAgentConnection] Could not parse JSON response:`, e);
      }
    }
    
    return { isOnline: true, metadata };
  } catch (error) {
    // Network errors, timeouts, or CORS issues mean the agent is offline
    let errorMessage = "Connection failed";
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMessage = "Connection timeout";
      } else if (error.message === "Failed to fetch") {
        // This usually means the server is not running or CORS issue
        errorMessage = "Agent not responding (server may not be running)";
      } else {
        errorMessage = error.message;
      }
    }
    console.warn(`[testAgentConnection] Agent health check failed for ${url}:`, errorMessage);
    return { 
      isOnline: false, 
      error: errorMessage
    };
  }
}

// Save a custom agent to localStorage
export function saveCustomAgent(name: string, url: string): CustomAgent {
  const newAgent: CustomAgent = {
    id: `custom-${Date.now()}`, // Simple unique ID generation
    name,
    url,
    createdAt: new Date().toISOString(),
  };

  // In a real implementation, we would save this to localStorage or a database
  // For now, we'll just return the agent object
  return newAgent;
}
