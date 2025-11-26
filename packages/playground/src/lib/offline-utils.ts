// Offline utilities for graceful degradation

import { type UIMessage } from "ai";
import { type Agent } from "@/lib/config";

// Type for offline messages
export interface OfflineMessage {
  id: string;
  agentId: string;
  message: string;
  timestamp: number;
  retries: number;
}

// Storage key for offline messages
const OFFLINE_MESSAGES_KEY = "offline-messages";

/**
 * Save a message to offline storage
 * 
 * @param agent - The agent the message was intended for
 * @param message - The message content
 * @returns Promise that resolves when message is saved
 */
export async function saveOfflineMessage(agent: Agent, message: string): Promise<void> {
  try {
    const offlineMessage: OfflineMessage = {
      id: crypto.randomUUID(),
      agentId: agent.id,
      message,
      timestamp: Date.now(),
      retries: 0
    };

    const existing = getOfflineMessages();
    const updated = [...existing, offlineMessage];
    
    localStorage.setItem(OFFLINE_MESSAGES_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Failed to save offline message:", error);
    // We don't throw here as this is a fallback mechanism
  }
}

/**
 * Get all offline messages from storage
 * 
 * @returns Array of offline messages
 */
export function getOfflineMessages(): OfflineMessage[] {
  try {
    const stored = localStorage.getItem(OFFLINE_MESSAGES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error("Failed to retrieve offline messages:", error);
    return [];
  }
}

/**
 * Remove an offline message from storage
 * 
 * @param id - ID of the message to remove
 * @returns Promise that resolves when message is removed
 */
export async function removeOfflineMessage(id: string): Promise<void> {
  try {
    const existing = getOfflineMessages();
    const updated = existing.filter(msg => msg.id !== id);
    localStorage.setItem(OFFLINE_MESSAGES_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Failed to remove offline message:", error);
    // We don't throw here as this is a fallback mechanism
  }
}

/**
 * Update retry count for an offline message
 * 
 * @param id - ID of the message to update
 * @param retries - New retry count
 * @returns Promise that resolves when message is updated
 */
export async function updateOfflineMessageRetries(id: string, retries: number): Promise<void> {
  try {
    const existing = getOfflineMessages();
    const updated = existing.map(msg => 
      msg.id === id ? { ...msg, retries } : msg
    );
    localStorage.setItem(OFFLINE_MESSAGES_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Failed to update offline message retries:", error);
    // We don't throw here as this is a fallback mechanism
  }
}

/**
 * Clear all offline messages
 * 
 * @returns Promise that resolves when storage is cleared
 */
export async function clearOfflineMessages(): Promise<void> {
  try {
    localStorage.removeItem(OFFLINE_MESSAGES_KEY);
  } catch (error) {
    console.error("Failed to clear offline messages:", error);
    // We don't throw here as this is a fallback mechanism
  }
}

/**
 * Check if browser is online
 * 
 * @returns True if online, false if offline
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

/**
 * Create an offline response message
 * 
 * @param message - The original message
 * @returns UIMessage for offline response
 */
export function createOfflineResponseMessage(message: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [{
      type: "text",
      text: `I'm currently offline. Your message "${message}" has been saved and will be sent when I'm back online.`
    }]
  };
}

/**
 * Create an offline notification message
 * 
 * @returns UIMessage for offline notification
 */
export function createOfflineNotificationMessage(): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [{
      type: "text",
      text: "You are currently offline. Messages will be saved and sent when you're back online."
    }]
  };
}