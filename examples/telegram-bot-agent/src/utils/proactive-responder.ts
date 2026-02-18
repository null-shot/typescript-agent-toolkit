/**
 * Proactive Responder
 * Decides when and how to respond to messages in proactive mode
 */

import { Context } from "grammy";
import type { ProactiveSettings } from "../types/proactive";
import { isQuestion, matchesKeywords } from "../types/proactive";
import {
  getProactiveSettings,
  canRespond,
  recordResponse,
} from "./proactive-storage";
import { getKnowledgeBasePrompt } from "./knowledge-base";
import { searchMemory, formatMemoryContext } from "./chat-memory";
import { parseAiSdkStreamText } from "./helpers";
import { loggers } from "./logger";

const log = loggers.proactive;

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  SESSIONS: KVNamespace;
  AGENT_URL?: string;
  AGENT_SERVICE?: Fetcher;
  AI?: Ai;
  CHAT_MEMORY?: VectorizeIndex;
}

export interface ProactiveCheckResult {
  shouldRespond: boolean;
  reason: string;
  trigger: "mention" | "reply" | "question" | "keyword" | "none";
}

/**
 * Check if bot should respond to this message proactively
 */
export async function shouldRespondProactively(
  ctx: Context,
  env: Env,
  messageText: string,
  botUsername: string,
): Promise<ProactiveCheckResult> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;

  if (!chatId || !userId) {
    return { shouldRespond: false, reason: "No chat/user", trigger: "none" };
  }

  // Only in groups
  const chatType = ctx.chat?.type;
  if (chatType !== "group" && chatType !== "supergroup") {
    return { shouldRespond: false, reason: "Not a group", trigger: "none" };
  }

  // Get settings
  const settings = await getProactiveSettings(env.SESSIONS, chatId);
  if (!settings || !settings.enabled) {
    return {
      shouldRespond: false,
      reason: "Proactive disabled",
      trigger: "none",
    };
  }

  // ── Detect trigger FIRST, then decide on rate limiting ──

  let detectedTrigger: ProactiveCheckResult["trigger"] = "none";
  let detectedReason = "No trigger matched";

  // 1. Bot mentioned (@botname) — highest priority
  if (settings.respondToMentions) {
    const mentionPattern = new RegExp(`@${botUsername}\\b`, "i");
    if (mentionPattern.test(messageText)) {
      detectedTrigger = "mention";
      detectedReason = "Bot mentioned";
    }
  }

  // 2. Reply to bot's message
  if (
    detectedTrigger === "none" &&
    settings.respondToReplies &&
    ctx.message?.reply_to_message
  ) {
    const repliedTo = ctx.message.reply_to_message;
    if (repliedTo.from?.id === ctx.me.id) {
      detectedTrigger = "reply";
      detectedReason = "Reply to bot";
    }
  }

  // 3. Trigger keywords
  if (detectedTrigger === "none" && settings.triggerKeywords.length > 0) {
    if (matchesKeywords(messageText, settings.triggerKeywords)) {
      detectedTrigger = "keyword";
      detectedReason = "Keyword match";
    }
  }

  // 4. Questions (with probability check)
  if (
    detectedTrigger === "none" &&
    settings.respondToQuestions &&
    isQuestion(messageText)
  ) {
    const roll = Math.random() * 100;
    if (roll <= settings.responseProbability) {
      detectedTrigger = "question";
      detectedReason = "Question detected";
    } else {
      return {
        shouldRespond: false,
        reason: `Question (${Math.round(roll)}% > ${settings.responseProbability}%)`,
        trigger: "none",
      };
    }
  }

  // No trigger matched → exit early
  if (detectedTrigger === "none") {
    log.debug(`No trigger for: "${messageText.substring(0, 60)}"`);
    return { shouldRespond: false, reason: detectedReason, trigger: "none" };
  }

  log.debug(
    `Trigger detected: ${detectedTrigger} — "${messageText.substring(0, 60)}"`,
  );

  // ── Rate limiting ──
  // Direct interactions (mention / reply) bypass cooldown — the user
  // explicitly addressed the bot, so it must answer.
  // Ambient triggers (keyword / question) still respect cooldown.
  const isDirectInteraction =
    detectedTrigger === "mention" || detectedTrigger === "reply";

  const rateLimitCheck = await canRespond(env.SESSIONS, settings);
  if (!rateLimitCheck.allowed && !isDirectInteraction) {
    return {
      shouldRespond: false,
      reason: rateLimitCheck.reason || "Rate limited",
      trigger: "none",
    };
  }

  // Even direct interactions respect the hourly hard cap
  if (isDirectInteraction && !rateLimitCheck.allowed) {
    // Check if it's an hourly limit (not just cooldown)
    if (
      rateLimitCheck.reason &&
      rateLimitCheck.reason.includes("Hourly limit")
    ) {
      return {
        shouldRespond: false,
        reason: rateLimitCheck.reason,
        trigger: "none",
      };
    }
    // It's just cooldown → allow for direct interactions
    log.debug("Bypassing cooldown for direct interaction", {
      trigger: detectedTrigger,
    });
  }

  return {
    shouldRespond: true,
    reason: detectedReason,
    trigger: detectedTrigger,
  };
}

/**
 * Generate response using AI agent
 */
export async function generateProactiveResponse(
  env: Env,
  settings: ProactiveSettings,
  messageText: string,
  trigger: string,
  userName?: string,
  chatId?: number,
): Promise<string | null> {
  const agentUrl = env.AGENT_URL || "";
  const hasAgent = !!agentUrl || !!env.AGENT_SERVICE;
  const hasWorkersAI = !!env.AI;

  if (!hasAgent && !hasWorkersAI) {
    log.warn("No AGENT_URL, AGENT_SERVICE, or Workers AI configured");
    return null;
  }

  // Build system prompt
  const defaultPrompt = `You are a sharp, knowledgeable AI assistant in a Telegram group chat. You have deep expertise in the project's domain and genuinely enjoy helping people understand complex topics.

Your personality:
- Smart and articulate — you explain things clearly without being condescending
- Witty and natural — you sound like a clever friend, not a corporate FAQ bot
- Culturally aware — you understand internet culture, crypto/web3 slang, memes, and developer humor
- Confident but honest — you give direct answers when you know, and say "I'm not sure" when you don't`;

  let systemPrompt = settings.systemPrompt || defaultPrompt;

  // Add project context if available
  if (settings.projectContext) {
    systemPrompt += `\n\nProject/Community Context:\n${settings.projectContext}`;
  }

  // Add personality
  if (settings.botPersonality) {
    systemPrompt += `\n\nPersonality: ${settings.botPersonality}`;
  }

  // Inject Knowledge Base from dashboard settings (shared utility)
  systemPrompt += await getKnowledgeBasePrompt(env.SESSIONS);

  // Inject relevant chat history from semantic memory
  if (chatId) {
    try {
      const memoryResults = await searchMemory(
        env as any,
        chatId,
        messageText,
        5,
      );
      const memoryContext = formatMemoryContext(memoryResults);
      if (memoryContext) {
        systemPrompt += memoryContext;
      }
    } catch {
      // Non-critical — proceed without memory context
    }
  }

  // Add response guidelines
  systemPrompt += `\n\nResponse rules (STRICT):
- Answer in 1-3 sentences. Be concise. No walls of text.
- Sound like a smart human, not a chatbot. No "I'd be happy to help" or "Great question!" filler.
- If someone asks a short casual question ("vibe code?", "wen token?", "gm"), give a short witty reply — don't ask for clarification on obvious slang
- Understand crypto/web3/dev slang: "vibe coding" = coding with AI vibes, "wen" = when, "gm" = good morning, "ser" = sir, "fren" = friend, "WAGMI" = we're all gonna make it, "LFG" = let's go
- Match the user's energy: casual question → casual answer, technical question → technical answer
- Match the language of the user's message (Russian → Russian, English → English, etc.)
- Format links as HTML: <a href="URL">link text</a> — NEVER paste raw URLs like https://...
- NEVER start your reply with the user's name, @mention, or greeting — jump straight to the answer
- ALWAYS use the Knowledge Base above for factual answers — do NOT make up information
- If you genuinely don't know, say so in one sentence and suggest where to look (docs, Discord, etc.)
- The [context] lines below are internal routing metadata — NEVER include them in your response`;

  // Build user context
  let userMessage = messageText;
  if (trigger === "mention") {
    userMessage = `[context: user mentioned you in group chat]\n${messageText}`;
  } else if (trigger === "reply") {
    userMessage = `[context: user replied to your message]\n${messageText}`;
  } else if (trigger === "keyword") {
    userMessage = `[context: triggered by keyword match]\n${messageText}`;
  } else {
    userMessage = `[context: question detected in group chat]\n${messageText}`;
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMessage },
  ];

  // ── Try Agent (service binding → HTTP) first, then Workers AI fallback ──
  if (hasAgent) {
    try {
      const sessionId = `proactive_${Date.now()}`;
      const url = `${agentUrl}/agent/chat/${sessionId}`;
      const useServiceBinding = !!env.AGENT_SERVICE;

      log.debug(
        `Generating response via agent: trigger=${trigger}, user="${userName}", msg="${messageText.substring(0, 60)}", binding=${useServiceBinding}`,
      );

      const fetchFn = useServiceBinding
        ? env.AGENT_SERVICE!.fetch.bind(env.AGENT_SERVICE!)
        : fetch;
      const response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId, messages }),
      });

      if (response.ok) {
        const rawText = await response.text();
        if (rawText.trim()) {
          const fullText = parseAiSdkStreamText(rawText);
          log.debug(`Agent response parsed: ${fullText.length} chars`);
          if (fullText) return fullText;
        }
      } else {
        const errBody = await response.text().catch(() => "(unreadable)");
        log.error(
          `Agent request failed: status=${response.status}, body=${errBody.substring(0, 200)}`,
        );
      }
    } catch (error) {
      log.error("Agent response failed", error);
    }
  }

  // ── Workers AI fallback (no external dependency) ──
  if (hasWorkersAI && env.AI) {
    try {
      log.debug("Generating response via Workers AI (support model)");
      const result = (await env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct-fp8" as keyof AiModels,
        { messages } as any,
      )) as { response?: string };
      const text = result.response?.trim();
      if (text) {
        log.debug(`Workers AI response: ${text.length} chars`);
        return text;
      }
    } catch (error) {
      log.error("Workers AI response failed", error);
    }
  }

  log.warn("All response generation methods failed");
  return null;
}

/**
 * Handle proactive response flow
 */
export async function handleProactiveResponse(
  ctx: Context,
  env: Env,
  messageText: string,
  checkResult: ProactiveCheckResult,
): Promise<boolean> {
  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  const settings = await getProactiveSettings(env.SESSIONS, chatId);
  if (!settings) return false;

  log.info(
    `Responding: chatId=${chatId}, trigger=${checkResult.trigger}, msg="${messageText.substring(0, 60)}"`,
  );

  // Show typing indicator
  await ctx.api.sendChatAction(chatId, "typing");

  // Generate response
  const response = await generateProactiveResponse(
    env,
    settings,
    messageText,
    checkResult.trigger,
    ctx.from?.first_name || ctx.from?.username,
    chatId,
  );

  if (!response) {
    log.debug(`No response generated for: "${messageText.substring(0, 60)}"`);
    return false;
  }

  log.debug(`Got response (${response.length} chars), sending reply...`);

  // Send response as reply (try HTML for links, fallback to plain)
  try {
    const replyOpts: Record<string, unknown> = {
      reply_to_message_id: ctx.message?.message_id,
    };

    // Try HTML parse_mode first (for <a href> links)
    try {
      await ctx.reply(response, { ...replyOpts, parse_mode: "HTML" });
    } catch {
      // HTML failed (malformed tags) — try plain text with reply
      try {
        await ctx.reply(response, replyOpts);
      } catch {
        // Reply-to also failed — send without reply reference
        log.info("Reply-to failed, sending plain message");
        await ctx.api.sendMessage(chatId, response);
      }
    }

    // Record the response for rate limiting
    await recordResponse(env.SESSIONS, settings);

    // Update Kanban task stats (support task)
    try {
      const { findActiveTask, incrementTaskStat, addTaskLog } =
        await import("./kanban-storage");
      const supportTask = await findActiveTask(env.SESSIONS, chatId, "support");
      if (supportTask) {
        await incrementTaskStat(env.SESSIONS, supportTask.id, "responses");
        await incrementTaskStat(
          env.SESSIONS,
          supportTask.id,
          checkResult.trigger,
        );
        await addTaskLog(
          env.SESSIONS,
          supportTask.id,
          `Responded to ${checkResult.trigger} from ${ctx.from?.first_name || "user"}: "${messageText.substring(0, 60)}..."`,
          checkResult.trigger,
        );
      }
    } catch {
      // Non-critical
    }

    log.info("Response sent", { length: response.length });
    return true;
  } catch (error) {
    log.error("Failed to send response", error);
    return false;
  }
}
