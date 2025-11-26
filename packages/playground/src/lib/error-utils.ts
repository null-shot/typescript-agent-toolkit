// Error utilities for enhanced error handling

import { toast } from "@/components/ui/use-toast";

// Custom error types
export class NetworkError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "NetworkError";
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export class AgentOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentOfflineError";
  }
}

export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

/**
 * Categorize and handle different types of errors
 * 
 * @param error - The error to categorize
 * @returns Categorized error with user-friendly message
 */
export function categorizeError(error: unknown): { type: string; message: string; shouldRetry: boolean } {
  if (error instanceof NetworkError) {
    return {
      type: "network",
      message: "Network connection failed. Please check your internet connection and try again.",
      shouldRetry: true
    };
  }
  
  if (error instanceof TimeoutError) {
    return {
      type: "timeout",
      message: "Request timed out. The agent may be busy or unavailable. Please try again.",
      shouldRetry: true
    };
  }
  
  if (error instanceof AgentOfflineError) {
    return {
      type: "agent-offline",
      message: "The selected agent is currently offline. Please select a different agent or try again later.",
      shouldRetry: false
    };
  }
  
  if (error instanceof AgentError) {
    return {
      type: "agent-error",
      message: `Agent error: ${error.message}`,
      shouldRetry: true
    };
  }
  
  if (error instanceof Error) {
    // Check for common network errors
    if (error.message.includes("Failed to fetch") || error.message.includes("NetworkError")) {
      return {
        type: "network",
        message: "Network connection failed. Please check your internet connection and try again.",
        shouldRetry: true
      };
    }
    
    // Check for timeout errors
    if (error.message.includes("timeout") || error.message.includes("AbortError")) {
      return {
        type: "timeout",
        message: "Request timed out. Please try again.",
        shouldRetry: true
      };
    }
    
    return {
      type: "unknown",
      message: error.message || "An unexpected error occurred. Please try again.",
      shouldRetry: true
    };
  }
  
  return {
    type: "unknown",
    message: "An unexpected error occurred. Please try again.",
    shouldRetry: true
  };
}

/**
 * Show error toast with appropriate styling based on error type
 * 
 * @param error - The error to display
 * @param title - Optional title for the toast
 */
export function showErrorToast(error: unknown, title?: string) {
  const categorized = categorizeError(error);
  
  toast({
    title: title || "Error",
    description: categorized.message,
    variant: "destructive",
  });
}

/**
 * Show success toast
 * 
 * @param title - Title for the toast
 * @param description - Description for the toast
 */
export function showSuccessToast(title: string, description?: string) {
  toast({
    title,
    description,
    variant: "default",
  });
}

/**
 * Show info toast
 * 
 * @param title - Title for the toast
 * @param description - Description for the toast
 */
export function showInfoToast(title: string, description?: string) {
  toast({
    title,
    description,
    variant: "default",
  });
}