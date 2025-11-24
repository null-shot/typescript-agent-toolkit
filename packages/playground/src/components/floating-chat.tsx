"use client";

import React from "react";
import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentSelector } from "@/components/agent-selector";
import { cn } from "@/lib/utils";
import { type Agent, DEFAULT_AGENT } from "@/lib/config";
import { type UIMessage } from "ai";
import { useAgentHealth } from "@/hooks/use-agent-health";
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
  createOfflineResponseMessage,
  createOfflineNotificationMessage,
} from "@/lib/offline-utils";

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
        className="px-8 py-4 text-lg font-semibold hover:scale-105 transition-transform bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 shadow-lg hover:shadow-xl"
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
  const [selectedAgent, setSelectedAgent] = useState<Agent>(DEFAULT_AGENT);
  const [input, setInput] = useState("");

  // Use manual message state management instead of useChat
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  // Monitor selected agent health
  const {
    health: agentHealth,
    isLoading: isHealthLoading,
    error: healthError,
    checkHealth,
  } = useAgentHealth(selectedAgent, 0);

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

  const sendMessage = useCallback(
    async (messageText: string) => {
      if (!messageText.trim()) return;

      // Handle offline mode
      if (isOffline || !isOnline()) {
        // Save message for later sending
        await saveOfflineMessage(selectedAgent, messageText.trim());

        // Add user message and offline response to chat
        const userMessage: UIMessage = {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: messageText.trim() }],
        };

        setMessages((prev) => [
          ...prev,
          userMessage,
          createOfflineResponseMessage(messageText.trim()),
        ]);
        setInput("");
        return;
      }

      // Check if agent is online before sending message
      try {
        const updatedAgent = await checkHealth(true);
        if (!updatedAgent.health?.isOnline) {
          // Save message for later sending
          await saveOfflineMessage(selectedAgent, messageText.trim());

          // Add user message and offline response to chat
          const userMessage: UIMessage = {
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text: messageText.trim() }],
          };

          const offlineResponse: UIMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            parts: [
              {
                type: "text",
                text: `The agent ${updatedAgent.name} is currently offline. Your message has been saved and will be sent when the agent is back online.`,
              },
            ],
          };

          setMessages((prev) => [...prev, userMessage, offlineResponse]);
          setInput("");
          showErrorToast(
            new AgentOfflineError(
              `Agent ${updatedAgent.name} is offline: ${updatedAgent.health?.error || "Unknown error"}`,
            ),
            "Agent Offline",
          );
          return;
        }
      } catch (err) {
        // Save message for later sending
        await saveOfflineMessage(selectedAgent, messageText.trim());

        // Add user message and offline response to chat
        const userMessage: UIMessage = {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: messageText.trim() }],
        };

        const offlineResponse: UIMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "There was an issue checking the agent status. Your message has been saved and will be sent when the connection is restored.",
            },
          ],
        };

        setMessages((prev) => [...prev, userMessage, offlineResponse]);
        setInput("");
        showErrorToast(err, "Health Check Failed");
        return;
      }

      // Add user message immediately
      const userMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: messageText.trim() }],
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);
      setInput("");

      // Create assistant message ID upfront
      const assistantMessageId = crypto.randomUUID();

      try {
        console.log("Sending message to agent:", messageText);

        const response = await fetch(`${selectedAgent.url}/agent/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [...messages, userMessage].map((msg) => ({
              role: msg.role,
              content:
                msg.parts?.find((part) => part.type === "text")?.text || "",
            })),
          }),
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });

        if (!response.ok) {
          let errorMessage = `Agent request failed: ${response.status}`;
          if (response.status === 404) {
            errorMessage =
              "Agent endpoint not found. Please check the agent URL.";
          } else if (response.status >= 500) {
            errorMessage = "Agent server error. Please try again later.";
          }

          throw new Error(errorMessage);
        }

        // Create assistant message
        const assistantMessage: UIMessage = {
          id: assistantMessageId,
          role: "assistant",
          parts: [{ type: "text", text: "" }],
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Handle streaming response
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === "text-delta" && data.delta) {
                  // Update the assistant message with the new delta
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? {
                            ...msg,
                            parts: msg.parts?.map((part) =>
                              part.type === "text"
                                ? { ...part, text: part.text + data.delta }
                                : part,
                            ),
                          }
                        : msg,
                    ),
                  );
                }
              } catch {
                // Ignore JSON parse errors for non-JSON lines
              }
            }
          }
        }

        // Show success message for completed response
        showSuccessToast("Message sent successfully");
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
    [selectedAgent, messages, checkHealth, isOffline],
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
      const lastText = lastUserMessage.parts?.find(
        (part) => part.type === "text",
      )?.text;
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
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] h-[90vh] sm:w-[600px] sm:h-[750px] lg:w-[700px] lg:h-[800px] z-50 max-w-4xl",
            className,
          )}
        >
          <div className="chat-container rounded-xl h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-t-xl">
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
                  className="h-8 w-8 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Chat Messages using AI Elements */}
            <Conversation
              className="flex-1 chat-messages"
              style={{ height: "auto" }}
            >
              <ConversationContent>
                {messages.length === 0 ? (
                  <ConversationEmptyState
                    icon={<MessageCircle className="h-12 w-12" />}
                    title="Start a conversation with your agent"
                    description={`Connected to ${selectedAgent.name}`}
                  />
                ) : (
                  messages.map((message: UIMessage) => (
                    <Message from={message.role} key={message.id}>
                      {message.role === "assistant" && (
                        <Avatar>
                          <AvatarImage src={agentAvatar} />
                        </Avatar>
                      )}
                      <MessageContent>
                        {message.role === "user" ? (
                          <div className="rounded-lg px-4 py-3 text-sm leading-relaxed message-user rounded-br-sm">
                            <div className="whitespace-pre-wrap break-words text-white">
                              {message.parts
                                ?.filter((part) => part.type === "text")
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
                                    <Response key={index} className="text-left">
                                      {part.text}
                                    </Response>
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
                      {message.role === "user" && (
                        <Avatar>
                          <AvatarImage src={userAvatar} />
                        </Avatar>
                      )}
                    </Message>
                  ))
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            {/* Chat Input using AI Elements PromptInput */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-b-xl">
              <PromptInput onSubmit={handleFormSubmit} className="mt-4">
                <PromptInputBody>
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
                      isHealthLoading ||
                      !agentHealth.health?.isOnline
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
                    isHealthLoading ||
                    !agentHealth.health?.isOnline
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
