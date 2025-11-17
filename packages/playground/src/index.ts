// Main playground components
export { FloatingChat, FloatingChatButton } from "@/components/floating-chat";
export type { FloatingChatInternalProps as FloatingChatProps } from "@/components/floating-chat";

// Agent context and provider
export { AgentProvider, useAgentContext, useAgentSelection, useAgentManagement } from "@/lib/agent-context";
export type { AgentContextState, AgentProviderProps } from "@/lib/agent-context";

// Agent management components
export { AgentSelector } from "@/components/agent-selector";
export type { AgentSelectorProps } from "@/components/agent-selector";

export { AddAgentModal } from "@/components/add-agent-modal";
export type { AddAgentModalProps } from "@/components/add-agent-modal";

// Utility hooks
export { useAgentHealth, useAgentsHealth } from "@/hooks/use-agent-health";

// Provider wrapper
export { PlaygroundProvider } from "@/components/playground-provider";
export type { PlaygroundProviderProps } from "@/components/playground-provider";

// Core types and utilities
export type { Agent, AgentHealthStatus } from "@/lib/config";
export { DEFAULT_AGENT } from "@/lib/config";

// UI components (selectively export useful ones)
export { Button } from "@/components/ui/button";
export { Card, CardContent, CardHeader } from "@/components/ui/card";
export { Input } from "@/components/ui/input";
export { Badge } from "@/components/ui/badge";