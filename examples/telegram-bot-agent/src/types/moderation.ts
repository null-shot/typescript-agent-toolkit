/**
 * Moderation Types for Community Manager
 */

export type ModerationAction = "delete" | "warn" | "mute" | "ban" | "none";
export type ContentCategory =
  | "spam"
  | "scam"
  | "adult"
  | "hate"
  | "flood"
  | "links"
  | "clean";

export interface ModerationSettings {
  chatId: number;
  chatTitle: string;
  enabled: boolean;
  // What to detect
  detectSpam: boolean;
  detectScam: boolean;
  detectAdult: boolean;
  detectHate: boolean;
  detectFlood: boolean;
  detectLinks: boolean;
  // Actions
  spamAction: ModerationAction;
  scamAction: ModerationAction;
  adultAction: ModerationAction;
  hateAction: ModerationAction;
  floodAction: ModerationAction;
  linksAction: ModerationAction;
  // Thresholds
  floodThreshold: number; // Messages per minute
  aiConfidenceThreshold: number; // 0-1, minimum confidence for AI detection
  // Notifications
  notifyAdmins: boolean;
  logChannelId?: number; // Channel to log moderation actions
  // Whitelist
  whitelistedUsers: number[]; // User IDs that bypass moderation
  whitelistedDomains: string[]; // Allowed domains
  // Timestamps
  createdAt: number;
  updatedAt: number;
}

export interface ModerationResult {
  category: ContentCategory;
  confidence: number; // 0-1
  action: ModerationAction;
  reason: string;
  details?: string;
}

export interface ModerationLog {
  id: string;
  chatId: number;
  userId: number;
  username?: string;
  messageId: number;
  messageText: string;
  result: ModerationResult;
  actionTaken: ModerationAction;
  timestamp: number;
}

export interface UserWarning {
  chatId: number;
  userId: number;
  count: number;
  lastWarning: number;
  reasons: string[];
}

/**
 * Default moderation settings
 */
export function getDefaultSettings(
  chatId: number,
  chatTitle: string,
): ModerationSettings {
  return {
    chatId,
    chatTitle,
    enabled: false, // Disabled by default, user must enable
    // Detection flags
    detectSpam: true,
    detectScam: true,
    detectAdult: false,
    detectHate: true,
    detectFlood: true,
    detectLinks: false,
    // Actions
    spamAction: "delete",
    scamAction: "delete",
    adultAction: "delete",
    hateAction: "warn",
    floodAction: "warn",
    linksAction: "none",
    // Thresholds
    floodThreshold: 15, // 15 messages per minute (5 was too aggressive)
    aiConfidenceThreshold: 0.7,
    // Notifications
    notifyAdmins: true,
    logChannelId: undefined,
    // Whitelist
    whitelistedUsers: [],
    whitelistedDomains: [],
    // Timestamps
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Category display info
 */
export const CATEGORY_INFO: Record<
  ContentCategory,
  { emoji: string; label: string; description: string }
> = {
  spam: {
    emoji: "🚫",
    label: "Spam",
    description: "Promotional messages, ads",
  },
  scam: {
    emoji: "⚠️",
    label: "Scam",
    description: "Fraud, phishing, fake offers",
  },
  adult: { emoji: "🔞", label: "Adult", description: "NSFW content" },
  hate: {
    emoji: "💢",
    label: "Hate",
    description: "Hate speech, discrimination",
  },
  flood: { emoji: "🌊", label: "Flood", description: "Too many messages" },
  links: { emoji: "🔗", label: "Links", description: "External links" },
  clean: { emoji: "✅", label: "Clean", description: "No issues detected" },
};

/**
 * Action display info
 */
export const ACTION_INFO: Record<
  ModerationAction,
  { emoji: string; label: string }
> = {
  delete: { emoji: "🗑️", label: "Delete" },
  warn: { emoji: "⚠️", label: "Warn" },
  mute: { emoji: "🔇", label: "Mute" },
  ban: { emoji: "🚫", label: "Ban" },
  none: { emoji: "✅", label: "None" },
};
