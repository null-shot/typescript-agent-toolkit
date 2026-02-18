/**
 * Bot Profile Types
 * Defines roles and configuration for the bot
 */

/**
 * Available bot roles
 */
export type BotRole = "content" | "moderator" | "support";

/**
 * Role information
 */
export interface RoleInfo {
  id: BotRole;
  emoji: string;
  title: string;
  description: string;
  features: string[];
  defaultPrompt: string;
}

/**
 * Bot profile - configuration for a chat
 */
export interface BotProfile {
  chatId: number;
  chatTitle: string;
  roles: BotRole[];
  setupComplete: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Role presets with default configurations
 */
export const ROLE_PRESETS: Record<BotRole, RoleInfo> = {
  content: {
    id: "content",
    emoji: "📢",
    title: "Content Manager",
    description: "Manages channels, posts, and scheduling",
    features: [
      "Post to channels",
      "Schedule posts",
      "AI content generation",
      "Multi-channel management",
    ],
    defaultPrompt: `You are a content creation assistant in a Telegram group.
When asked to write or create content:
- Generate engaging posts ready for publishing
- Adapt tone and language to the target audience
- Use emojis and hashtags naturally
- Match the language the user writes in
Keep it creative, concise, and ready to post.`,
  },
  moderator: {
    id: "moderator",
    emoji: "🛡️",
    title: "Moderator",
    description: "Protects groups from spam and unwanted content",
    features: [
      "Spam detection",
      "Scam protection",
      "Flood control",
      "User warnings and bans",
    ],
    defaultPrompt: `You are a moderator in a Telegram group.
Moderation is handled automatically (spam, scam, flood detection).
When users ask about moderation:
- Explain current settings and how protection works
- Help configure whitelist/blacklist
- Review recent moderation actions
Be fair, transparent, and protective of the community.`,
  },
  support: {
    id: "support",
    emoji: "🎧",
    title: "Support Agent",
    description: "Answers questions and helps users proactively",
    features: [
      "Answer questions automatically",
      "Respond to mentions",
      "Keyword-triggered responses",
      "Context-aware assistance",
    ],
    defaultPrompt: `You are a sharp, knowledgeable support agent in a Telegram group. You have deep expertise in the project and genuinely enjoy helping people.

Your style:
- Smart and concise — answer in 1-3 sentences, no filler
- Sound like a clever human, not a corporate bot — no "I'd be happy to help!" nonsense
- Understand internet/crypto/dev culture and slang naturally
- Match the user's language and energy level
- Use the Knowledge Base for accuracy — never make things up
- If you don't know, say so honestly and point to docs or community
- Format links as HTML, never raw URLs`,
  },
};

/**
 * Get role info by ID
 */
export function getRoleInfo(role: BotRole): RoleInfo {
  return ROLE_PRESETS[role];
}

/**
 * Get all available roles
 */
export function getAllRoles(): RoleInfo[] {
  return Object.values(ROLE_PRESETS);
}

/**
 * Get combined prompt for multiple roles
 */
export function getCombinedPrompt(roles: BotRole[]): string {
  if (roles.length === 0) {
    return "You are a helpful assistant.";
  }

  if (roles.length === 1) {
    return ROLE_PRESETS[roles[0]].defaultPrompt;
  }

  const roleNames = roles.map((r) => ROLE_PRESETS[r].title).join(", ");
  const combinedFeatures = roles
    .flatMap((r) => ROLE_PRESETS[r].features)
    .slice(0, 6)
    .join("\n- ");

  return `You are a versatile assistant combining the roles of ${roleNames}.

Your capabilities include:
- ${combinedFeatures}

Be helpful, professional, and adapt to what the user needs.`;
}

/**
 * Check if profile has a specific role
 */
export function hasRole(profile: BotProfile, role: BotRole): boolean {
  return profile.roles.includes(role);
}

/**
 * Create default profile
 */
export function createDefaultProfile(
  chatId: number,
  chatTitle: string,
): BotProfile {
  return {
    chatId,
    chatTitle,
    roles: [],
    setupComplete: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
