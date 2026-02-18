/**
 * Task Types
 *
 * Natural language task detection for the Telegram bot.
 * Users can give tasks like "write a post about X" or "start moderating"
 * instead of using slash commands.
 */

export type TaskType =
  | "write_post"
  | "moderate_on"
  | "moderate_off"
  | "engage_on"
  | "engage_off"
  | "images_on"
  | "images_off"
  | "none";

export interface DetectedTask {
  type: TaskType;
  /** For write_post: the topic/instructions for content generation */
  topic?: string;
  /** Original user message */
  message: string;
}
