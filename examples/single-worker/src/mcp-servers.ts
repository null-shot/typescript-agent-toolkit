/**
 * MCP Server Durable Object Classes
 *
 * Extracted from index.ts — contains TodoMcpServer, ExpenseMcpServer,
 * EnvVariableMcpServer, and SecretMcpServer.
 * Re-exported from index.ts so wrangler can discover them as DO bindings.
 */

import { McpHonoServerDO } from "@nullshot/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Hono } from "hono";

// ============================================================================
// TODO MCP SERVER
// ============================================================================

/**
 * Simple Todo MCP Server
 * Demonstrates MCP server in same worker as agent
 * Agent can auto-discover and use these tools!
 */
export class TodoMcpServer extends McpHonoServerDO<Env> {
  private todos: Map<string, { id: string; text: string; completed: boolean }> =
    new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    console.log("🏗️ [TodoMcpServer] Constructor called");

    // Load todos from storage
    ctx.blockConcurrencyWhile(async () => {
      const stored =
        await ctx.storage.get<
          Record<string, { id: string; text: string; completed: boolean }>
        >("todos");
      if (stored) {
        this.todos = new Map(Object.entries(stored));
        console.log(
          `📦 [TodoMcpServer] Loaded ${this.todos.size} todos from storage`,
        );
      } else {
        console.log(
          `📦 [TodoMcpServer] No todos found in storage, starting fresh`,
        );
      }
    });
  }

  getImplementation(): Implementation {
    return {
      name: "TodoMcpServer",
      version: "1.0.0",
    };
  }

  configureServer(server: McpServer): void {
    console.log("🔧 [TodoMcpServer] configureServer: Registering tools...");

    // Tool: Create todo
    server.tool(
      "create_todo",
      "Create a new todo item",
      {
        text: z.string().describe("The todo text"),
      },
      async ({ text }) => {
        console.log(`📝 [TodoMcpServer] create_todo called: text="${text}"`);
        try {
          const id = crypto.randomUUID();
          const todo = { id, text, completed: false };
          this.todos.set(id, todo);
          // Convert Map to object for storage (Map doesn't serialize well)
          const todosObj = Object.fromEntries(this.todos);
          await this.ctx.storage.put("todos", todosObj);
          console.log(`✅ [TodoMcpServer] create_todo: Created todo id=${id}`);
          return {
            content: [
              { type: "text", text: `Created todo: ${text} (id: ${id})` },
            ],
          };
        } catch (error) {
          console.error(`❌ [TodoMcpServer] create_todo error:`, error);
          throw error;
        }
      },
    );

    // Tool: List todos
    server.tool("list_todos", "List all todo items", {}, async () => {
      console.log(`📝 [TodoMcpServer] list_todos called`);
      try {
        const todoList = Array.from(this.todos.values());
        console.log(
          `📋 [TodoMcpServer] list_todos: Found ${todoList.length} todos`,
        );
        if (todoList.length === 0) {
          console.log(`📋 [TodoMcpServer] list_todos: No todos found`);
          return {
            content: [{ type: "text", text: "No todos found." }],
          };
        }
        const text = todoList
          .map((t) => `- [${t.completed ? "x" : " "}] ${t.text} (id: ${t.id})`)
          .join("\n");
        console.log(
          `✅ [TodoMcpServer] list_todos: Returning ${todoList.length} todos`,
        );
        return {
          content: [{ type: "text", text: `Todos:\n${text}` }],
        };
      } catch (error) {
        console.error(`❌ [TodoMcpServer] list_todos error:`, error);
        throw error;
      }
    });

    // Tool: Complete todo
    server.tool(
      "complete_todo",
      "Mark a todo as completed",
      {
        id: z.string().describe("The todo ID to complete"),
      },
      async ({ id }) => {
        console.log(`📝 [TodoMcpServer] complete_todo called: id="${id}"`);
        try {
          const todo = this.todos.get(id);
          if (!todo) {
            console.log(
              `⚠️ [TodoMcpServer] complete_todo: Todo not found id=${id}`,
            );
            return {
              content: [{ type: "text", text: `Todo not found: ${id}` }],
            };
          }
          todo.completed = true;
          this.todos.set(id, todo);
          // Convert Map to object for storage
          const todosObj = Object.fromEntries(this.todos);
          await this.ctx.storage.put("todos", todosObj);
          console.log(
            `✅ [TodoMcpServer] complete_todo: Completed todo id=${id}, text="${todo.text}"`,
          );
          return {
            content: [{ type: "text", text: `Completed: ${todo.text}` }],
          };
        } catch (error) {
          console.error(`❌ [TodoMcpServer] complete_todo error:`, error);
          throw error;
        }
      },
    );

    // Tool: Delete todo
    server.tool(
      "delete_todo",
      "Delete a todo item",
      {
        id: z.string().describe("The todo ID to delete"),
      },
      async ({ id }) => {
        console.log(`📝 [TodoMcpServer] delete_todo called: id="${id}"`);
        try {
          const todo = this.todos.get(id);
          if (!todo) {
            console.log(
              `⚠️ [TodoMcpServer] delete_todo: Todo not found id=${id}`,
            );
            return {
              content: [{ type: "text", text: `Todo not found: ${id}` }],
            };
          }
          this.todos.delete(id);
          // Convert Map to object for storage
          const todosObj = Object.fromEntries(this.todos);
          await this.ctx.storage.put("todos", todosObj);
          console.log(
            `✅ [TodoMcpServer] delete_todo: Deleted todo id=${id}, text="${todo.text}"`,
          );
          return {
            content: [{ type: "text", text: `Deleted: ${todo.text}` }],
          };
        } catch (error) {
          console.error(`❌ [TodoMcpServer] delete_todo error:`, error);
          throw error;
        }
      },
    );

    console.log("✅ [TodoMcpServer] configureServer: All tools registered");
  }
}

// ============================================================================
// EXPENSE MCP SERVER
// ============================================================================

/**
 * Expense Tracking MCP Server
 * Tools: submit_expense, approve_expense, reject_expense, list_expenses
 */
export class ExpenseMcpServer extends McpHonoServerDO<Env> {
  private expenses: Map<
    string,
    {
      id: string;
      user: string;
      amount: number;
      description: string;
      status: "pending" | "approved" | "rejected";
      createdAt: string;
    }
  > = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    console.log("🏗️ [ExpenseMcpServer] Constructor called");
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<Record<string, any>>("expenses");
      if (stored) {
        this.expenses = new Map(Object.entries(stored));
        console.log(
          `📦 [ExpenseMcpServer] Loaded ${this.expenses.size} expenses from storage`,
        );
      }
    });
  }

  getImplementation(): Implementation {
    return { name: "ExpenseMcpServer", version: "1.0.0" };
  }

  configureServer(server: McpServer): void {
    console.log("🔧 [ExpenseMcpServer] Registering tools...");

    server.tool(
      "submit_expense",
      "Submit a new expense for approval",
      {
        user: z.string().describe("The user submitting the expense"),
        amount: z.coerce.number().describe("The expense amount"),
        description: z.string().describe("Description of the expense"),
      },
      async ({ user, amount, description }) => {
        const id = crypto.randomUUID();
        const expense = {
          id,
          user,
          amount,
          description,
          status: "pending" as const,
          createdAt: new Date().toISOString(),
        };
        this.expenses.set(id, expense);
        await this.ctx.storage.put(
          "expenses",
          Object.fromEntries(this.expenses),
        );
        console.log(
          `✅ [ExpenseMcpServer] Submitted expense id=${id}, $${amount} by ${user}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Expense submitted: $${amount} by ${user} - "${description}" (id: ${id}, status: pending)`,
            },
          ],
        };
      },
    );

    server.tool(
      "approve_expense",
      "Approve a pending expense",
      { id: z.string().describe("The expense ID to approve") },
      async ({ id }) => {
        const expense = this.expenses.get(id);
        if (!expense)
          return {
            content: [{ type: "text", text: `Expense not found: ${id}` }],
          };
        expense.status = "approved";
        await this.ctx.storage.put(
          "expenses",
          Object.fromEntries(this.expenses),
        );
        console.log(`✅ [ExpenseMcpServer] Approved expense id=${id}`);
        return {
          content: [
            {
              type: "text",
              text: `Approved: $${expense.amount} by ${expense.user} - "${expense.description}"`,
            },
          ],
        };
      },
    );

    server.tool(
      "reject_expense",
      "Reject a pending expense",
      { id: z.string().describe("The expense ID to reject") },
      async ({ id }) => {
        const expense = this.expenses.get(id);
        if (!expense)
          return {
            content: [{ type: "text", text: `Expense not found: ${id}` }],
          };
        expense.status = "rejected";
        await this.ctx.storage.put(
          "expenses",
          Object.fromEntries(this.expenses),
        );
        console.log(`✅ [ExpenseMcpServer] Rejected expense id=${id}`);
        return {
          content: [
            {
              type: "text",
              text: `Rejected: $${expense.amount} by ${expense.user} - "${expense.description}"`,
            },
          ],
        };
      },
    );

    server.tool(
      "list_expenses",
      "List all expenses with their status",
      {},
      async () => {
        const list = Array.from(this.expenses.values());
        if (!list.length)
          return { content: [{ type: "text", text: "No expenses found." }] };
        const total = list.reduce((sum, e) => sum + e.amount, 0);
        const byStatus = { pending: 0, approved: 0, rejected: 0 };
        list.forEach((e) => {
          byStatus[e.status] = (byStatus[e.status] || 0) + 1;
        });
        const text = list
          .map(
            (e) =>
              `[${e.status}] $${e.amount} by ${e.user}: ${e.description} (id: ${e.id})`,
          )
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Expenses (Total: $${total}, pending: ${byStatus.pending}, approved: ${byStatus.approved}, rejected: ${byStatus.rejected}):\n${text}`,
            },
          ],
        };
      },
    );

    console.log("✅ [ExpenseMcpServer] All tools registered");
  }
}

// ============================================================================
// ENV VARIABLE MCP SERVER
// ============================================================================

/**
 * Environment Variable Demo MCP Server
 * Tools: greeting (uses DEFAULT_NAME env var)
 */
export class EnvVariableMcpServer extends McpHonoServerDO<Env> {
  protected env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
  }

  getImplementation(): Implementation {
    return { name: "EnvVariableMcpServer", version: "1.0.0" };
  }

  configureServer(server: McpServer): void {
    console.log("🔧 [EnvVariableMcpServer] Registering tools...");

    server.tool(
      "greeting",
      "Send a greeting using an optional name (falls back to DEFAULT_NAME env var)",
      {
        name: z
          .string()
          .optional()
          .describe(
            'The name to greet. If not supplied, uses DEFAULT_NAME env var or "World"',
          ),
      },
      async ({ name }) => {
        const greetingName = name || this.env.DEFAULT_NAME || "World";
        console.log(
          `✅ [EnvVariableMcpServer] Greeting: Hello ${greetingName}!`,
        );
        return { content: [{ type: "text", text: `Hello ${greetingName}!` }] };
      },
    );

    console.log("✅ [EnvVariableMcpServer] All tools registered");
  }
}

// ============================================================================
// SECRET MCP SERVER
// ============================================================================

/**
 * Secret Number Guessing Game MCP Server
 * Tools: guess_number (uses SECRET_NUMBER env var)
 */
export class SecretMcpServer extends McpHonoServerDO<Env> {
  protected env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
  }

  getImplementation(): Implementation {
    return { name: "SecretMcpServer", version: "1.0.0" };
  }

  configureServer(server: McpServer): void {
    console.log("🔧 [SecretMcpServer] Registering tools...");

    server.tool(
      "guess_number",
      "Guess the secret number! I will tell you if your guess is correct, too high, or too low.",
      {
        guess: z.coerce.number().describe("Your number guess"),
      },
      async ({ guess }) => {
        const secretNumber = parseInt(this.env.SECRET_NUMBER || "42", 10);
        console.log(
          `🎯 [SecretMcpServer] Guess: ${guess}, Secret: ${secretNumber}`,
        );
        if (guess === secretNumber) {
          return {
            content: [
              {
                type: "text",
                text: `You guessed ${guess} — correct! 🎉 You found the secret number!`,
              },
            ],
          };
        }
        const hint = guess < secretNumber ? "Try higher!" : "Try lower!";
        return {
          content: [
            { type: "text", text: `You guessed ${guess} — wrong. ${hint}` },
          ],
        };
      },
    );

    console.log("✅ [SecretMcpServer] All tools registered");
  }
}

// ============================================================================
// Helper: read Workers AI result into ArrayBuffer
// ============================================================================

async function readAiResult(result: unknown): Promise<ArrayBuffer> {
  if (result instanceof ReadableStream) {
    const reader = result.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const totalLength = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged.buffer;
  }
  if (result instanceof ArrayBuffer) {
    return result;
  }
  if (result && typeof result === "object") {
    // Base64 response: { image: "..." } or { audio: "..." }
    const b64 =
      (result as any).image ?? (result as any).audio ?? undefined;
    if (typeof b64 === "string") {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }
  }
  throw new Error("Unexpected response format from Workers AI model");
}

/** Shared media metadata stored in DO storage */
interface MediaMeta {
  id: string;
  contentType: string;
  prompt: string;
  createdAt: string;
}

/** Adds a /media/:id route to a McpHonoServerDO for serving stored files */
function addMediaRoutes(
  app: Hono<{ Bindings: Env }>,
  ctx: DurableObjectState,
) {
  app.get("/media/:id", async (c) => {
    const mediaId = c.req.param("id");
    const meta = await ctx.storage.get<MediaMeta>(`media:${mediaId}:meta`);
    const data = await ctx.storage.get<ArrayBuffer>(`media:${mediaId}:data`);
    if (!meta || !data) {
      return c.json({ error: "Not found" }, 404);
    }
    return new Response(data, {
      headers: {
        "Content-Type": meta.contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  });
}

// ============================================================================
// IMAGE MCP SERVER
// ============================================================================

/**
 * Image Generation MCP Server
 * Uses Workers AI (Flux) to generate images from text prompts.
 * Generated images stored in DO storage, served via /media/image/:id route.
 */
export class ImageMcpServer extends McpHonoServerDO<Env> {
  protected env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
  }

  getImplementation(): Implementation {
    return { name: "ImageMcpServer", version: "1.0.0" };
  }

  protected setupRoutes(app: Hono<{ Bindings: Env }>): void {
    // Register media routes BEFORE super (which adds a catch-all for MCP paths)
    addMediaRoutes(app, this.ctx);
    super.setupRoutes(app);
  }

  configureServer(server: McpServer): void {
    console.log("🔧 [ImageMcpServer] Registering tools...");

    server.tool(
      "generate_image",
      "Generate an image from a text description using AI. Returns a URL to view/embed the generated image.",
      {
        prompt: z
          .string()
          .describe(
            "Detailed description of the image to generate (English works best)",
          ),
        steps: z.coerce
          .number()
          .min(1)
          .max(8)
          .optional()
          .describe(
            "Number of diffusion steps (1-8, default 4). More steps = better quality but slower",
          ),
      },
      async ({ prompt, steps }) => {
        console.log(`🎨 [ImageMcpServer] generate_image: "${prompt}"`);

        if (!this.env.AI) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Workers AI binding (AI) is not configured.",
              },
            ],
          };
        }

        try {
          const result = await this.env.AI.run(
            "@cf/black-forest-labs/flux-1-schnell" as any,
            { prompt, num_steps: steps || 4 },
          );
          const imageBuffer = await readAiResult(result);

          const mediaId = crypto.randomUUID().slice(0, 12);
          const meta: MediaMeta = {
            id: mediaId,
            contentType: "image/png",
            prompt,
            createdAt: new Date().toISOString(),
          };
          await this.ctx.storage.put(`media:${mediaId}:meta`, meta);
          await this.ctx.storage.put(`media:${mediaId}:data`, imageBuffer);

          const sizeKb = Math.round(imageBuffer.byteLength / 1024);
          console.log(
            `✅ [ImageMcpServer] Generated: id=${mediaId}, ${sizeKb}KB`,
          );

          return {
            content: [
              {
                type: "text",
                text: `Image generated successfully!\n\nURL: /media/image/${mediaId}\nPrompt: "${prompt}"\nSize: ${sizeKb}KB\n\nDisplay with markdown: ![${prompt}](/media/image/${mediaId})`,
              },
            ],
          };
        } catch (error) {
          console.error(`❌ [ImageMcpServer] error:`, error);
          return {
            content: [
              {
                type: "text",
                text: `Error generating image: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    );

    console.log("✅ [ImageMcpServer] Tools registered");
  }
}

// ============================================================================
// VOICE MCP SERVER
// ============================================================================

/**
 * Voice / Text-to-Speech MCP Server
 * Uses Workers AI (MeloTTS) to convert text to speech.
 * Generated audio stored in DO storage, served via /media/audio/:id route.
 */
export class VoiceMcpServer extends McpHonoServerDO<Env> {
  protected env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
  }

  getImplementation(): Implementation {
    return { name: "VoiceMcpServer", version: "1.0.0" };
  }

  protected setupRoutes(app: Hono<{ Bindings: Env }>): void {
    addMediaRoutes(app, this.ctx);

    app.post("/tts", async (c) => {
      const { text, language } = await c.req.json<{
        text: string;
        language?: string;
      }>();
      if (!text) return c.json({ error: "text required" }, 400);

      try {
        const ttsText =
          text.length > 900 ? text.slice(0, 900) + "..." : text;
        const result = await this.env.AI.run(
          "@cf/myshell-ai/melotts" as any,
          { prompt: ttsText, lang: language || "en" },
        );

        let audioBuffer: ArrayBuffer;
        if (result && typeof (result as any).audio === "string") {
          const binaryStr = atob((result as any).audio);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          audioBuffer = bytes.buffer;
        } else {
          audioBuffer = await readAiResult(result);
        }

        const mediaId = crypto.randomUUID().slice(0, 12);
        const meta: MediaMeta = {
          id: mediaId,
          contentType: "audio/mpeg",
          prompt: ttsText.slice(0, 100),
          createdAt: new Date().toISOString(),
        };
        await this.ctx.storage.put(`media:${mediaId}:meta`, meta);
        await this.ctx.storage.put(`media:${mediaId}:data`, audioBuffer);

        return c.json({ audioUrl: `/media/audio/${mediaId}` });
      } catch (e) {
        console.error("[VoiceMcpServer] /tts error:", e);
        return c.json(
          { error: e instanceof Error ? e.message : "TTS failed" },
          500,
        );
      }
    });

    super.setupRoutes(app);
  }

  configureServer(server: McpServer): void {
    console.log("🔧 [VoiceMcpServer] Registering tools...");

    server.tool(
      "text_to_speech",
      "Convert text to speech audio. Returns a URL to the generated audio file. Supports: English, Spanish, French, Chinese, Japanese, Korean.",
      {
        text: z
          .string()
          .max(1000)
          .describe("The text to convert to speech (max 1000 characters)"),
        language: z
          .enum(["en", "es", "fr", "zh", "ja", "ko"])
          .optional()
          .describe(
            "Language: en (English), es (Spanish), fr (French), zh (Chinese), ja (Japanese), ko (Korean). Default: en",
          ),
      },
      async ({ text, language }) => {
        console.log(
          `🔊 [VoiceMcpServer] tts: "${text.slice(0, 50)}...", lang=${language || "en"}`,
        );

        if (!this.env.AI) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Workers AI binding (AI) is not configured.",
              },
            ],
          };
        }

        try {
          const result = await this.env.AI.run(
            "@cf/myshell-ai/melotts" as any,
            { prompt: text, lang: language || "en" },
          );

          // MeloTTS returns { audio: base64string } or raw audio
          let audioBuffer: ArrayBuffer;
          if (result && typeof (result as any).audio === "string") {
            // Base64-encoded audio
            const b64 = (result as any).audio;
            const binaryStr = atob(b64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            audioBuffer = bytes.buffer;
          } else {
            audioBuffer = await readAiResult(result);
          }

          const mediaId = crypto.randomUUID().slice(0, 12);
          const meta: MediaMeta = {
            id: mediaId,
            contentType: "audio/mpeg",
            prompt: text.slice(0, 100),
            createdAt: new Date().toISOString(),
          };
          await this.ctx.storage.put(`media:${mediaId}:meta`, meta);
          await this.ctx.storage.put(`media:${mediaId}:data`, audioBuffer);

          const sizeKb = Math.round(audioBuffer.byteLength / 1024);
          console.log(
            `✅ [VoiceMcpServer] Generated: id=${mediaId}, ${sizeKb}KB`,
          );

          return {
            content: [
              {
                type: "text",
                text: `Audio generated!\n\nURL: /media/audio/${mediaId}\nText: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"\nLanguage: ${language || "en"}\nSize: ${sizeKb}KB\n\nEmbed audio: [Listen](/media/audio/${mediaId})`,
              },
            ],
          };
        } catch (error) {
          console.error(`❌ [VoiceMcpServer] error:`, error);
          return {
            content: [
              {
                type: "text",
                text: `Error generating speech: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    );

    console.log("✅ [VoiceMcpServer] Tools registered");
  }
}
