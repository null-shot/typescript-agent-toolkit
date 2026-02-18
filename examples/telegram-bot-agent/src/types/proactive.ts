/**
 * Proactive Mode Types
 * Bot automatically responds to questions and mentions in group chats
 */

export type ProactiveMode = "support" | "community" | "custom" | "off";

export interface ProactiveSettings {
  chatId: number;
  chatTitle: string;
  enabled: boolean;
  mode: ProactiveMode;

  // Triggers - when to respond
  respondToMentions: boolean; // @botname
  respondToReplies: boolean; // reply to bot's message
  respondToQuestions: boolean; // messages with ?
  triggerKeywords: string[]; // custom keywords

  // Rate limiting
  responseProbability: number; // 0-100, chance to respond to questions
  cooldownSeconds: number; // min time between responses
  maxResponsesPerHour: number; // limit per hour

  // Context
  systemPrompt: string; // custom prompt for this chat
  projectContext: string; // project description/FAQ
  botPersonality: string; // how bot should behave

  // Stats
  responsesThisHour: number;
  lastResponseTime: number;
  hourStartTime: number;

  // Timestamps
  createdAt: number;
  updatedAt: number;
}

/**
 * Default proactive settings
 */
export function getDefaultProactiveSettings(
  chatId: number,
  chatTitle: string,
): ProactiveSettings {
  return {
    chatId,
    chatTitle,
    enabled: false,
    mode: "off",

    // Triggers
    respondToMentions: true,
    respondToReplies: true,
    respondToQuestions: true,
    triggerKeywords: [],

    // Rate limiting
    responseProbability: 50, // 50% chance for questions
    cooldownSeconds: 30, // 30 sec between responses
    maxResponsesPerHour: 9999, // effectively unlimited

    // Context
    systemPrompt: "",
    projectContext: "",
    botPersonality: "helpful and friendly",

    // Stats
    responsesThisHour: 0,
    lastResponseTime: 0,
    hourStartTime: Date.now(),

    // Timestamps
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Preset prompts for different modes
 */
export const MODE_PRESETS: Record<
  ProactiveMode,
  { prompt: string; description: string }
> = {
  support: {
    description: "Answers questions, helps users, responds to mentions",
    prompt: `You are an AI assistant participating in a group chat.

How you get activated:
- Someone @mentions you — always respond
- Someone replies to your message — always respond
- Someone asks a question — respond based on probability setting
- A trigger keyword appears — respond if configured

How to respond:
- Read the conversation context before answering
- Give clear, concise answers (2-4 sentences unless more detail is needed)
- Match the language the user writes in (auto-detect Russian, English, etc.)
- Be friendly and natural — you're a chat member, not a formal assistant
- If you don't know something, say so honestly
- Use emojis sparingly and naturally

Important:
- Don't repeat yourself if you already answered the same question recently
- Don't interrupt ongoing conversations between users
- If the question is about a specific product/project, use the Knowledge Base context if available`,
  },
  community: {
    description: "Engages in discussions, keeps the vibe positive",
    prompt: `You are a friendly community member in this group chat.

How you get activated:
- Someone @mentions you — always respond
- Someone replies to your message — always respond
- Someone asks a question — respond based on probability setting

How to respond:
- Be warm, approachable, and match the group's energy
- Keep it brief and natural — like a real person would
- Encourage helpful discussions and engagement
- Gently redirect off-topic or heated conversations
- Match the language the user writes in

Important:
- Don't dominate the conversation — contribute, don't lecture
- If someone is having a bad day, be empathetic
- Celebrate wins and positive moments in the community`,
  },
  custom: {
    description: "Custom configuration",
    prompt: "", // User provides their own
  },
  off: {
    description: "Proactive mode disabled",
    prompt: "",
  },
};

/**
 * Question indicators in different languages
 */
export const QUESTION_PATTERNS = {
  // Question marks
  punctuation: /\?/,

  // English question words
  en: /\b(what|when|where|why|who|how|which|whose|whom|can|could|would|should|is|are|do|does|did|will|have|has|had)\b.*\?/i,

  // Russian question words (use (?:^|\s|[^а-яёА-ЯЁ]) instead of \b for Cyrillic)
  ru: /(?:^|\s|[^а-яёА-ЯЁa-zA-Z])(что|кто|где|когда|зачем|почему|как|какой|какая|какое|какие|сколько|чей|куда|откуда)(?:\s|$|[^а-яёА-ЯЁa-zA-Z])/i,

  // Help requests (mixed English \b + Cyrillic boundary)
  help: /(?:\b(help|explain|tell me|how do i|how can i)|(?:^|\s|[^а-яёА-ЯЁa-zA-Z])(помогите|подскажите|объясните|расскажите))/i,
};

/**
 * Check if message looks like a question
 */
export function isQuestion(text: string): boolean {
  // Has question mark
  if (QUESTION_PATTERNS.punctuation.test(text)) return true;

  // Has question words
  if (QUESTION_PATTERNS.en.test(text)) return true;
  if (QUESTION_PATTERNS.ru.test(text)) return true;
  if (QUESTION_PATTERNS.help.test(text)) return true;

  return false;
}

/**
 * Check if message contains trigger keywords
 */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;

  const lowerText = text.toLowerCase();
  return keywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
}
