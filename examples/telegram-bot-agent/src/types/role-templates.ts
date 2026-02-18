/**
 * Role Templates
 *
 * Preset configurations that combine bot identity + capabilities + default tasks.
 * Owner picks a template during setup → bot config, chat settings, and initial
 * kanban tasks are pre-configured.
 */

import type { BotRole } from "./bot-profile";

export interface RoleTemplate {
  id: string;
  emoji: string;
  title: string;
  description: string;
  /** Primary role */
  role: BotRole;
  /** Additional capabilities to enable */
  capabilities: {
    moderation?: boolean;
    posting?: boolean;
    proactive?: boolean;
  };
  /** Default system prompt */
  systemPrompt: string;
  /** Proactive mode to enable (if proactive capability) */
  proactiveMode?: "support" | "community" | "custom";
  /** Example use cases */
  examples: string[];
}

/**
 * Built-in role templates
 */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: "saas-support",
    emoji: "🎧",
    title: "SaaS Support Bot",
    description: "Answers customer questions about your product",
    role: "support",
    capabilities: {
      proactive: true,
    },
    proactiveMode: "support",
    systemPrompt: `You are a friendly and knowledgeable support agent.
Answer questions clearly and concisely.
If you don't know the answer, say so honestly and offer to escalate.
Keep responses short — 2-3 sentences max unless the question requires detail.`,
    examples: [
      "SaaS product support in community chat",
      "Developer documentation assistant",
      "Customer onboarding helper",
    ],
  },
  {
    id: "crypto-community",
    emoji: "🪙",
    title: "Crypto Community Manager",
    description: "Manages a crypto/DeFi community — moderation + engagement",
    role: "support",
    capabilities: {
      moderation: true,
      proactive: true,
      posting: true,
    },
    proactiveMode: "community",
    systemPrompt: `You are a community manager for a crypto/DeFi project.
Keep the chat positive and informative.
Answer questions about tokenomics, staking, and roadmap.
Warn against scams and phishing — protect the community.
Be concise and use relevant emojis.`,
    examples: [
      "Token community with active trading discussion",
      "DAO governance chat",
      "DeFi protocol support",
    ],
  },
  {
    id: "news-channel",
    emoji: "📰",
    title: "News Channel Manager",
    description: "Creates and publishes content for a news/media channel",
    role: "content",
    capabilities: {
      posting: true,
    },
    systemPrompt: `You are a professional content creator for a news channel.
Write engaging, factual posts.
Use attention-grabbing hooks and concise language.
Adapt tone: professional for news, casual for lifestyle.
Include relevant emojis naturally.`,
    examples: [
      "Tech news aggregation channel",
      "Industry updates and analysis",
      "Local news digest",
    ],
  },
  {
    id: "edu-group",
    emoji: "📚",
    title: "Educational Group Assistant",
    description: "Helps students/learners in an educational group",
    role: "support",
    capabilities: {
      moderation: true,
      proactive: true,
    },
    proactiveMode: "support",
    systemPrompt: `You are a helpful educational assistant.
Answer questions with clear explanations and examples.
Encourage learning and curiosity.
Keep off-topic discussion to a minimum.
If a question is too complex, break it down step by step.`,
    examples: [
      "Programming bootcamp group",
      "University course chat",
      "Language learning community",
    ],
  },
  {
    id: "ecommerce-support",
    emoji: "🛒",
    title: "E-Commerce Support",
    description: "Handles customer inquiries for an online store",
    role: "support",
    capabilities: {
      proactive: true,
    },
    proactiveMode: "support",
    systemPrompt: `You are a customer support agent for an online store.
Help with: order status, returns, product questions, shipping.
Be polite, empathetic, and solution-oriented.
If you can't resolve an issue, escalate to the team.
Keep responses brief and professional.`,
    examples: [
      "Shopify store support chat",
      "Marketplace seller support",
      "Product recommendation bot",
    ],
  },
  {
    id: "custom",
    emoji: "⚙️",
    title: "Custom Configuration",
    description: "Start from scratch — configure everything manually",
    role: "support",
    capabilities: {},
    systemPrompt: "You are a helpful assistant.",
    examples: ["Fully customized bot for any use case"],
  },
];

/**
 * Get a template by ID
 */
export function getTemplate(id: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Get all templates
 */
export function getAllTemplates(): RoleTemplate[] {
  return ROLE_TEMPLATES;
}
