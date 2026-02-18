"use client";

import React from "react";
import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentSelector } from "@/components/agent-selector";
import { cn } from "@/lib/utils";
import { type Agent, getDefaultAgent } from "@/lib/config";
import { type UIMessage, type TextUIPart } from "ai";
import { useAgentHealth } from "@/hooks/use-agent-health";
import { useAgentContext } from "@/lib/agent-context";
import {
  showErrorToast,
  showSuccessToast,
  showInfoToast,
  NetworkError,
  TimeoutError,
  AgentOfflineError,
} from "@/lib/error-utils";
import {
  saveOfflineMessage,
  getOfflineMessages,
  isOnline,
  createOfflineNotificationMessage,
} from "@/lib/offline-utils";

// Type guard to narrow UIMessagePart to TextUIPart (TypeScript can't narrow through .find()/.filter())
function isTextPart(part: UIMessage["parts"][0]): part is TextUIPart {
  return part.type === "text";
}

// Type guard to check if a part has tool-related properties
function isToolUIPart(
  part: UIMessage["parts"][0],
): part is UIMessage["parts"][0] & {
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  input?: Record<string, unknown>;
  output?: string | Record<string, unknown>;
  errorText?: string;
} {
  return part.type.startsWith("tool-") && "state" in part;
}

// Real AI Elements components
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Response } from "@/components/ai-elements/response";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Avatar, AvatarImage } from "@/components/ui/avatar";

// Separate button component for the main page
export function FloatingChatButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        size="lg"
        variant="default"
        className="px-8 py-4 text-lg font-semibold hover:scale-105 transition-transform bg-[#00d4aa] hover:bg-[#14b8a6] text-black border-none shadow-lg hover:shadow-xl"
      >
        <MessageCircle className="h-5 w-5 mr-2" />
        Start Chat
      </Button>

      {isOpen && (
        <FloatingChat isOpen={isOpen} onClose={() => setIsOpen(false)} />
      )}
    </>
  );
}

export interface FloatingChatInternalProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

export function FloatingChat({
  isOpen,
  onClose,
  className,
}: FloatingChatInternalProps) {
  // Use getDefaultAgent() to read env vars dynamically
  const [selectedAgent, setSelectedAgent] = useState<Agent>(() => getDefaultAgent());
  const [input, setInput] = useState("");

  // Use manual message state management instead of useChat
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  // Monitor selected agent health
  const {
    health: agentHealth,
    checkHealth,
  } = useAgentHealth(selectedAgent, 30000); // Check every 30 seconds

  // Get agent context to sync health updates and get agents
  const agentContext = useAgentContext();
  const updateAgentHealthRef = React.useRef(agentContext.updateAgentHealth);
  
  // Sync selected agent with context (use first agent from context if available)
  React.useEffect(() => {
    if (agentContext.agents.length > 0) {
      const contextAgent = agentContext.agents.find(a => a.id === agentContext.selectedAgentId) || agentContext.agents[0];
      if (contextAgent.url !== selectedAgent.url || contextAgent.name !== selectedAgent.name) {
        setSelectedAgent(contextAgent);
      }
    }
  }, [agentContext.agents, agentContext.selectedAgentId, selectedAgent.url, selectedAgent.name]);
  
  // Keep ref updated
  React.useEffect(() => {
    updateAgentHealthRef.current = agentContext.updateAgentHealth;
  }, [agentContext.updateAgentHealth]);

  // Sync health updates from useAgentHealth to context and local state
  // Use ref to track last synced health to prevent infinite loops
  const lastSyncedHealthRef = React.useRef<{ isOnline?: boolean; lastChecked?: number } | null>(null);

  useEffect(() => {
    if (agentHealth?.health && selectedAgent) {
      const newHealth = agentHealth.health;
      const lastSynced = lastSyncedHealthRef.current;
      
      // Only update if health actually changed
      if (!lastSynced || 
          lastSynced.isOnline !== newHealth.isOnline ||
          lastSynced.lastChecked !== newHealth.lastChecked) {
        // Update context
        updateAgentHealthRef.current(selectedAgent.id, newHealth);
        
        // Update local selectedAgent state so AgentSelector shows correct health
        setSelectedAgent(prev => ({
          ...prev,
          health: newHealth,
          lastChecked: newHealth.lastChecked,
        }));
        
        lastSyncedHealthRef.current = {
          isOnline: newHealth.isOnline,
          lastChecked: newHealth.lastChecked,
        };
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed to avoid infinite re-render loops
  }, [agentHealth?.health?.isOnline, agentHealth?.health?.lastChecked, selectedAgent?.id]);

  // Force health check when chat opens
  useEffect(() => {
    if (isOpen) {
      checkHealth(true).catch(() => {
        // Ignore errors, health check will retry
      });
    }
  }, [isOpen, checkHealth]);

  // Random avatars
  const [userAvatar] = useState(
    () => `/avatars/${Math.floor(Math.random() * 19) + 1}.png`,
  );
  const [agentAvatar] = useState(
    () => `/avatars/${Math.floor(Math.random() * 19) + 1}.png`,
  );

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      showSuccessToast("You're back online!");

      // Try to send any offline messages
      const offlineMessages = getOfflineMessages();
      if (offlineMessages.length > 0) {
        showInfoToast(
          `Found ${offlineMessages.length} saved messages. Attempting to send...`,
        );
      }
    };

    const handleOffline = () => {
      setIsOffline(true);
      showInfoToast(
        "You're offline",
        "Messages will be saved and sent when you're back online.",
      );

      // Add offline notification to chat
      setMessages((prev) => [...prev, createOfflineNotificationMessage()]);
    };

    // Set initial online status
    setIsOffline(!isOnline());

    // Add event listeners
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleAgentChange = (agent: Agent) => {
    setSelectedAgent(agent);
    setMessages([]); // Clear messages when agent changes
  };

  // Helper to handle offline/unavailable scenarios: saves message and adds offline response to chat
  const handleOfflineMessage = useCallback(
    async (messageText: string, responseText: string, toastError?: unknown, toastTitle?: string) => {
      await saveOfflineMessage(selectedAgent, messageText);

      const userMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: messageText }],
      };

      const offlineResponse: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text: responseText }],
      };

      setMessages((prev) => [...prev, userMessage, offlineResponse]);
      setInput("");

      if (toastError) {
        showErrorToast(toastError, toastTitle || "Error");
      }
    },
    [selectedAgent],
  );

  const sendMessage = useCallback(
    async (messageText: string) => {
      if (!messageText.trim()) return;
      const trimmedText = messageText.trim();

      // Handle offline mode
      if (isOffline || !isOnline()) {
        await handleOfflineMessage(
          trimmedText,
          "You are currently offline. Your message has been saved and will be sent when you're back online.",
        );
        return;
      }

      // Check if agent is online before sending message
      try {
        const updatedAgent = await checkHealth(true);
        if (!updatedAgent.health?.isOnline) {
          await handleOfflineMessage(
            trimmedText,
            `The agent ${updatedAgent.name} is currently offline. Your message has been saved and will be sent when the agent is back online.`,
            new AgentOfflineError(
              `Agent ${updatedAgent.name} is offline: ${updatedAgent.health?.error || "Unknown error"}`,
            ),
            "Agent Offline",
          );
          return;
        }
      } catch (err) {
        await handleOfflineMessage(
          trimmedText,
          "There was an issue checking the agent status. Your message has been saved and will be sent when the connection is restored.",
          err,
          "Health Check Failed",
        );
        return;
      }

      // Add user message immediately
      const userMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: trimmedText }],
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);
      setInput("");

      // Create assistant message ID upfront
      const assistantMessageId = crypto.randomUUID();

      try {
        // Build message history using functional state to avoid stale closure
        const messageHistory = await new Promise<UIMessage[]>((resolve) => {
          setMessages((prev) => {
            resolve(prev);
            return prev;
          });
        });

        const response = await fetch(`${selectedAgent.url}/agent/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: messageHistory
              .map((msg) => {
                const textContent = msg.parts?.find(isTextPart)?.text || "";
                return {
                  role: msg.role,
                  content: textContent,
                };
              })
              .filter((msg) => {
                // Filter out empty messages - Anthropic API requires non-empty content
                const content = typeof msg.content === "string" ? msg.content.trim() : "";
                return content.length > 0;
              }),
          }),
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });

        if (!response.ok) {
          let errorMessage = `Agent request failed: ${response.status}`;
          let errorDetails = "";
          
          // Try to get error details from response body
          try {
            const errorText = await response.text();
            if (errorText) {
              try {
                const errorJson = JSON.parse(errorText);
                errorDetails = errorJson.message || errorJson.error || errorText;
              } catch {
                errorDetails = errorText;
              }
            }
          } catch {
            // Ignore errors when reading error response
          }
          
          if (response.status === 404) {
            errorMessage =
              "Agent endpoint not found. Please check the agent URL.";
          } else if (response.status >= 500) {
            errorMessage = `Agent server error (${response.status}). ${errorDetails || "Please try again later."}`;
          } else if (response.status === 400) {
            errorMessage = `Bad request: ${errorDetails || "Please check your message format."}`;
          }

          console.error("[FloatingChat] Agent request failed:", {
            status: response.status,
            statusText: response.statusText,
            details: errorDetails,
          });

          throw new Error(errorMessage);
        }

        // Create assistant message
        const assistantMessage: UIMessage = {
          id: assistantMessageId,
          role: "assistant",
          parts: [{ type: "text", text: "" }],
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Handle streaming response (SSE format from AI SDK)
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let accumulatedText = "";
        let buffer = "";
        let isSSEFormat = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Decode the chunk
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Check if this looks like SSE format
          if (buffer.includes("0:") || buffer.includes("data: ")) {
            isSSEFormat = true;
          }

          // If not SSE format, treat as plain text
          if (!isSSEFormat) {
            accumulatedText += chunk;
            continue;
          }

          // Parse SSE format: "0:"text"" or "data: {...}"
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;

            // Handle AI SDK format: "0:"text""
            if (line.startsWith("0:")) {
              try {
                const jsonStr = line.slice(2); // Remove "0:" prefix
                const parsed = JSON.parse(jsonStr);
                if (typeof parsed === "string") {
                  accumulatedText += parsed;
                } else if (parsed.type === "text-delta" && parsed.delta) {
                  accumulatedText += parsed.delta;
                } else if (parsed.text) {
                  accumulatedText += parsed.text;
                }
              } catch {
                // If parsing fails, treat as plain text
                accumulatedText += line.slice(2);
              }
            }
            // Handle standard SSE format: "data: {...}"
            else if (line.startsWith("data: ")) {
              try {
                const jsonStr = line.slice(6); // Remove "data: " prefix
                const parsed = JSON.parse(jsonStr);
                if (parsed.type === "text-delta" && parsed.delta) {
                  accumulatedText += parsed.delta;
                } else if (parsed.text) {
                  accumulatedText += parsed.text;
                } else if (typeof parsed === "string") {
                  accumulatedText += parsed;
                }
              } catch {
                // If parsing fails, skip this line
                console.warn("Failed to parse SSE data:", line);
              }
            }
            // Handle plain text lines in SSE stream
            else if (line.trim() && !line.startsWith(":")) {
              accumulatedText += line;
            }
          }
        }

        // If no text was accumulated and buffer has content, treat as plain text
        if (accumulatedText === "" && buffer.trim()) {
          accumulatedText = buffer.trim();
        }

        // Update the message with accumulated text
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  parts: msg.parts?.map((part) =>
                    part.type === "text"
                      ? { ...part, text: accumulatedText }
                      : part,
                  ),
                }
              : msg,
          ),
        );
      } catch (err) {
        console.error("Error sending message:", err);

        // Categorize and handle the error
        if (err instanceof Error) {
          if (err.name === "AbortError") {
            showErrorToast(
              new TimeoutError("Request timed out after 30 seconds"),
              "Timeout",
            );
          } else if (err.message.includes("Failed to fetch")) {
            showErrorToast(
              new NetworkError("Network connection failed"),
              "Network Error",
            );
          } else {
            showErrorToast(err, "Error");
          }
        } else {
          showErrorToast(new Error("Unknown error occurred"), "Error");
        }

        setError(err instanceof Error ? err : new Error("Unknown error"));

        // Remove the assistant message if there was an error
        setMessages((prev) =>
          prev.filter((msg) => msg.id !== assistantMessageId),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [selectedAgent, checkHealth, isOffline, handleOfflineMessage],
  );

  const handleFormSubmit = (
    message: PromptInputMessage,
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    // For now, we'll handle text messages only
    // File attachments can be added later when needed
    if (message.text?.trim()) {
      sendMessage(message.text);
      setInput("");
    }
  };

  const reload = () => {
    // Clear error and retry the last user message
    setError(null);
    const lastUserMessage = messages.filter((msg) => msg.role === "user").pop();
    if (lastUserMessage) {
      const lastText = lastUserMessage.parts?.find(isTextPart)?.text;
      if (lastText) {
        // Remove the last assistant message if it exists and retry
        setMessages((prev) => {
          const lastAssistantIndex = prev
            .map((msg) => msg.role)
            .lastIndexOf("assistant");
          return lastAssistantIndex >= 0
            ? prev.slice(0, lastAssistantIndex)
            : prev;
        });
        sendMessage(lastText);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ scale: 0.8, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.8, opacity: 0, y: 20 }}
          className={cn(
            // Base positioning styles — equal padding from edges in all modes
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] z-50",
            // Mobile mode (below 1024px): no max-width constraint
            "h-[90vh]",
            // Large screen (1024px+): fixed width for a compact look
            "lg:w-[515px] lg:h-[800px]",
            // On mobile/medium screens (below 1024px): bottom offset to avoid overlapping Next.js Dev Tools,
            // disable vertical centering and constrain height
            "max-lg:top-auto max-lg:bottom-[60px] max-lg:translate-y-0 max-lg:h-[calc(100vh-110px)]",
            className,
          )}
        >
          <div className="chat-container rounded-xl h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.08)] bg-[#0a0a0a] rounded-t-xl">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <AgentSelector
                  selectedAgent={selectedAgent}
                  onAgentChange={handleAgentChange}
                  className="flex-1 min-w-0"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="h-8 w-8 text-[#a0a0a0] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Chat Messages using AI Elements */}
            <Conversation
              className="flex-1 chat-messages overflow-y-auto"
              style={{ height: "auto" }}
            >
              <ConversationContent className="!px-6 !pt-6 !pb-4 min-h-full">
                {messages.length === 0 ? (
                  <ConversationEmptyState
                    icon={<MessageCircle className="h-12 w-12" />}
                    title="Start a conversation with your agent"
                    description={`Connected to ${selectedAgent.name}`}
                  />
                ) : (
                  messages.map((message: UIMessage) => {
                    const isUser = message.role === "user";
                    return (
                      <Message 
                        from={message.role} 
                        key={message.id} 
                        className={cn(
                          "!flex-row items-end gap-3 mb-5",
                          isUser ? "justify-end" : "justify-start"
                        )}
                      >
                        {!isUser && (
                          <Avatar className="shrink-0 order-1">
                            <AvatarImage src={agentAvatar} />
                          </Avatar>
                        )}
                        <MessageContent className={cn(
                          "max-w-[70%] min-w-0",
                          isUser ? "order-1" : "order-2"
                        )}>
                          {isUser ? (
                            <div className="rounded-lg px-4 py-3 text-sm leading-relaxed message-user rounded-br-sm">
                              <div className="whitespace-pre-wrap break-words text-black">
                                {message.parts
                                  ?.filter(isTextPart)
                                  ?.map((part, index) => (
                                    <span key={index}>{part.text}</span>
                                  ))}
                              </div>
                            </div>
                          ) : (
                            <>
                              {message.parts?.map((part, index: number) => {
                                switch (part.type) {
                                  case "text":
                                    return (
                                      <div 
                                        key={index}
                                        className="rounded-lg px-4 py-3 text-sm leading-relaxed bg-[#1e1e1e] border border-[rgba(255,255,255,0.05)] rounded-bl-sm text-[#d0d0d0]"
                                      >
                                        <Response 
                                          className="text-left break-words prose prose-sm dark:prose-invert max-w-none"
                                        >
                                          {part.text}
                                        </Response>
                                      </div>
                                    );
                                  default:
                                    // Handle tool calls with AI Elements Tool component
                                    if (isToolUIPart(part)) {
                                      return (
                                        <Tool
                                          key={index}
                                          defaultOpen={
                                            part.state === "output-available" ||
                                            part.state === "output-error"
                                          }
                                        >
                                          <ToolHeader
                                            type={
                                              part.type.startsWith("tool-")
                                                ? (part.type as `tool-${string}`)
                                                : `tool-${part.type}`
                                            }
                                            state={
                                              part.state || "input-streaming"
                                            }
                                          />
                                          <ToolContent>
                                            {part.input && (
                                              <ToolInput input={part.input} />
                                            )}
                                            {(part.output || part.errorText) && (
                                              <ToolOutput
                                                output={part.output}
                                                errorText={part.errorText}
                                              />
                                            )}
                                          </ToolContent>
                                        </Tool>
                                      );
                                    }
                                    return null;
                                }
                              })}
                            </>
                          )}
                        </MessageContent>
                        {isUser && (
                          <Avatar className="shrink-0 order-2">
                            <AvatarImage src={userAvatar} />
                          </Avatar>
                        )}
                      </Message>
                    );
                  })
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            {/* Error state with retry */}
            {error && (
              <div className="px-4 py-2.5 bg-[rgba(255,100,80,0.08)] border-t border-[rgba(255,100,80,0.15)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-[#ff6450] truncate">
                    {error.message}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={reload}
                    className="shrink-0 h-7 px-2.5 text-xs text-[#ff6450] hover:text-white hover:bg-[rgba(255,100,80,0.15)]"
                  >
                    <RotateCcw className="h-3 w-3 mr-1.5" />
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {/* Chat Input using AI Elements PromptInput */}
            <div className="px-6 py-5 border-t border-[rgba(255,255,255,0.08)] bg-[#1a1a1a] rounded-b-xl">
              <PromptInput onSubmit={handleFormSubmit} className="gap-0">
                <PromptInputBody className="gap-2">
                  <PromptInputAttachments>
                    {(attachment) => (
                      <PromptInputAttachment data={attachment} />
                    )}
                  </PromptInputAttachments>
                  <PromptInputTextarea
                    value={input}
                    onChange={handleInputChange}
                    placeholder="Type your message..."
                    disabled={
                      isLoading ||
                      (agentHealth.health !== undefined && !agentHealth.health.isOnline)
                    }
                  />
                </PromptInputBody>
                <PromptInputTools>
                  <PromptInputActionMenu>
                    <PromptInputActionMenuTrigger />
                    <PromptInputActionMenuContent>
                      <PromptInputActionAddAttachments />
                    </PromptInputActionMenuContent>
                  </PromptInputActionMenu>
                </PromptInputTools>
                <PromptInputSubmit
                  status={isLoading ? "streaming" : "ready"}
                  disabled={
                    !input?.trim() ||
                    isLoading ||
                    (agentHealth.health !== undefined && !agentHealth.health.isOnline)
                  }
                />
              </PromptInput>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
