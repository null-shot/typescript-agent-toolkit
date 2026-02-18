/**
 * Playground Types
 * Types for the lightweight playground UI that can be embedded in a single worker
 */

/**
 * Agent definition for playground UI
 */
export interface PlaygroundAgent {
	/** Unique identifier for the agent */
	id: string;
	/** Display name shown in UI */
	name: string;
	/** Optional description */
	description?: string;
	/** API path for this agent (e.g., '/agent/sales') */
	path: string;
	/** Show system prompt editor for this agent (default: true) */
	systemPrompt?: boolean;
}

/**
 * Tab definition for playground UI
 * Tabs extend the playground beyond the chat interface
 */
export interface PlaygroundTab {
	/** Unique identifier for the tab */
	id: string;
	/** Display label shown in tab bar */
	label: string;
	/** Icon (emoji or text) shown before label */
	icon?: string;
	/** API endpoint for fetching tab data */
	apiPath?: string;
	/** Tab type determines rendering behavior */
	type: 'chat' | 'dashboard' | 'custom';
}

/**
 * Options for setupPlaygroundRoutes
 */
export interface PlaygroundOptions {
	/** List of agents to display in the UI */
	agents?: PlaygroundAgent[];
	/** Additional tabs beyond the default chat tab */
	tabs?: PlaygroundTab[];
	/** Page title (default: 'AI Agent Playground') */
	title?: string;
	/** Base path for playground routes (default: '') */
	basePath?: string;
	/** Primary accent color for UI (default: '#00d4aa') */
	primaryColor?: string;
	/** Accent hover color, used for hover/focus states (default: '#14b8a6') */
	secondaryColor?: string;
}
