"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentSelector } from "@/components/agent-selector";
import { cn } from "@/lib/utils";
import { type Agent, DEFAULT_AGENT } from "@/lib/config";
import { type UIMessage } from "ai";

// Type guard to check if a part has tool-related properties
function isToolUIPart(
  part: UIMessage["parts"][0]
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
import {
  Message,
  MessageContent,
  MessageAvatar,
} from "@/components/ai-elements/message";
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
  PromptInputToolbar,
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

interface FloatingChatInternalProps {
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

  // Random avatars
  const [userAvatar] = useState(
    () => `/avatars/${Math.floor(Math.random() * 19) + 1}.png`
  );
  const [agentAvatar] = useState(
    () => `/avatars/${Math.floor(Math.random() * 19) + 1}.png`
  );

  const handleAgentChange = (agent: Agent) => {
    setSelectedAgent(agent);
    setMessages([]); // Clear messages when agent changes
  };

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim()) return;

    // Add user message immediately
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: messageText.trim() }],
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

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
      });

      if (!response.ok) {
        throw new Error(`Agent request failed: ${response.status}`);
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
                              : part
                          ),
                        }
                      : msg
                  )
                );
              }
            } catch {
              // Ignore JSON parse errors for non-JSON lines
            }
          }
        }
      }
    } catch (err) {
      console.error("Error sending message:", err);
      setError(err instanceof Error ? err : new Error("Unknown error"));

      // Remove the assistant message if there was an error
      setMessages((prev) =>
        prev.filter((msg) => msg.id !== assistantMessageId)
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = (
    message: PromptInputMessage,
    event: React.FormEvent<HTMLFormElement>
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
        (part) => part.type === "text"
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
            className
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
                        <MessageAvatar
                          src={agentAvatar}
                          name={selectedAgent.name}
                        />
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
                        <MessageAvatar src={userAvatar} name="User" />
                      )}
                    </Message>
                  ))
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            {/* Chat Input using AI Elements PromptInput */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-b-xl">
              {error && (
                <div className="mb-3 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center justify-between">
                  <span>Something went wrong. Please try again.</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => reload()}
                    className="text-red-400 hover:text-red-300 ml-2"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Retry
                  </Button>
                </div>
              )}

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
                    disabled={isLoading}
                  />
                </PromptInputBody>
                <PromptInputToolbar>
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
                    disabled={!input?.trim() || isLoading}
                  />
                </PromptInputToolbar>
              </PromptInput>

              {/* Status indicator */}
              {isLoading && (
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-current rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-2 h-2 bg-current rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 bg-current rounded-full animate-bounce"></div>
                  </div>
                  Agent is thinking...
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
