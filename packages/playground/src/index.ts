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
export { Separator } from "@/components/ui/separator";
export { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
export { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
export { Label } from "@/components/ui/label";
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export { Textarea } from "@/components/ui/textarea";
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
export { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
export { Progress } from "@/components/ui/progress";
export { Alert, AlertDescription } from "@/components/ui/alert";

// AI Elements components
export { Actions } from "@/components/ai-elements/actions";
export type { ActionsProps } from "@/components/ai-elements/actions";

export { Artifact } from "@/components/ai-elements/artifact";
export type { ArtifactProps } from "@/components/ai-elements/artifact";

export { Branch } from "@/components/ai-elements/branch";
export type { BranchProps } from "@/components/ai-elements/branch";

export { Canvas } from "@/components/ai-elements/canvas";

export { ChainOfThought } from "@/components/ai-elements/chain-of-thought";
export type { ChainOfThoughtProps } from "@/components/ai-elements/chain-of-thought";

export { Checkpoint } from "@/components/ai-elements/checkpoint";
export type { CheckpointProps } from "@/components/ai-elements/checkpoint";

export { CodeBlock } from "@/components/ai-elements/code-block";

export { Confirmation } from "@/components/ai-elements/confirmation";
export type { ConfirmationProps } from "@/components/ai-elements/confirmation";

export { Connection } from "@/components/ai-elements/connection";

export { Context } from "@/components/ai-elements/context";
export type { ContextProps } from "@/components/ai-elements/context";

export { Controls } from "@/components/ai-elements/controls";
export type { ControlsProps } from "@/components/ai-elements/controls";

export { Conversation } from "@/components/ai-elements/conversation";
export type { ConversationProps } from "@/components/ai-elements/conversation";

export { Edge } from "@/components/ai-elements/edge";

export { Image } from "@/components/ai-elements/image";
export type { ImageProps } from "@/components/ai-elements/image";

export { InlineCitation } from "@/components/ai-elements/inline-citation";
export type { InlineCitationProps } from "@/components/ai-elements/inline-citation";

export { Loader } from "@/components/ai-elements/loader";
export type { LoaderProps } from "@/components/ai-elements/loader";

export { Message } from "@/components/ai-elements/message";
export type { MessageProps } from "@/components/ai-elements/message";

export { ModelSelector } from "@/components/ai-elements/model-selector";
export type { ModelSelectorProps } from "@/components/ai-elements/model-selector";

export { Node } from "@/components/ai-elements/node";
export type { NodeProps } from "@/components/ai-elements/node";

export { OpenIn, OpenInChatGPT, OpenInClaude, OpenInCursor, OpenInT3, OpenInScira, OpenInv0 } from "@/components/ai-elements/open-in-chat";
export type { OpenInProps, OpenInChatGPTProps, OpenInClaudeProps, OpenInCursorProps, OpenInT3Props, OpenInSciraProps, OpenInv0Props } from "@/components/ai-elements/open-in-chat";

export { Panel } from "@/components/ai-elements/panel";

export { Plan } from "@/components/ai-elements/plan";
export type { PlanProps } from "@/components/ai-elements/plan";

export { PromptInput } from "@/components/ai-elements/prompt-input";
export type { PromptInputProps } from "@/components/ai-elements/prompt-input";

export { Queue } from "@/components/ai-elements/queue";
export type { QueueProps } from "@/components/ai-elements/queue";

export { Reasoning } from "@/components/ai-elements/reasoning";
export type { ReasoningProps } from "@/components/ai-elements/reasoning";

export { Response } from "@/components/ai-elements/response";

export { Shimmer } from "@/components/ai-elements/shimmer";
export type { TextShimmerProps as ShimmerProps } from "@/components/ai-elements/shimmer";

export { Sources } from "@/components/ai-elements/sources";
export type { SourcesProps } from "@/components/ai-elements/sources";

export { Suggestions } from "@/components/ai-elements/suggestion";
export type { SuggestionsProps } from "@/components/ai-elements/suggestion";

export { Task } from "@/components/ai-elements/task";
export type { TaskProps } from "@/components/ai-elements/task";

export { Toolbar } from "@/components/ai-elements/toolbar";

export { WebPreview } from "@/components/ai-elements/web-preview";
export type { WebPreviewProps } from "@/components/ai-elements/web-preview";

// Utility functions
export { cn } from "@/lib/utils";
export { getRecommendedAgents } from "@/lib/agent-utils";
export { testAgentConnection } from "@/lib/agent-storage";
export { saveOfflineMessage, getOfflineMessages, isOnline } from "@/lib/offline-utils";
export { showErrorToast, showSuccessToast, showInfoToast } from "@/lib/error-utils";
export { NetworkError, TimeoutError, AgentOfflineError } from "@/lib/error-utils";

// Re-export commonly used types from AI SDK
export type { UIMessage, FileUIPart, ToolUIPart } from "ai";