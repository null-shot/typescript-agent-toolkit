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

// Test connection to agent endpoint
export async function testAgentConnection(url: string): Promise<{ isOnline: boolean; error?: string }> {
  try {
    // Ping the root endpoint expecting 404 (which means agent is alive)
    const response = await fetch(`${url}/`, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // 5 second timeout
      // Don't throw on error status codes
      // We want to catch network errors, not HTTP status errors
    });
    
    // Agent is alive if we get any response (including 404)
    // 404 means the server is running but the route doesn't exist (which is expected)
    // Any HTTP response (even 404, 500, etc.) means the server is running
    // Only network errors (CORS, timeout, connection refused) mean offline
    console.log(`Agent health check succeeded for ${url}, status: ${response.status}`);
    return { isOnline: true };
  } catch (error) {
    // Network errors, timeouts, or CORS issues mean the agent is offline
    const errorMessage = error instanceof Error ? error.message : "Connection failed";
    console.warn(`Agent health check failed for ${url}:`, errorMessage, error);
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
