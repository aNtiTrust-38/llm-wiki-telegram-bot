import { Telegraf } from "telegraf";
import { handleQuery } from "./handlers/query";
import { handleIngest } from "./handlers/ingest";
import { callClaudeWithMCP } from "./mcp";

export function createBot(): Telegraf {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

  // Auth gate — silently drop messages from unauthorized chat IDs
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    if (chatId !== process.env.TELEGRAM_ALLOWED_CHAT_ID) return;
    return next();
  });

  bot.command("start", (ctx) => {
    ctx.reply(
      "llm-wiki bot\n\n" +
        "Send a question to search the vault.\n" +
        "Send a URL to ingest it into raw/.\n\n" +
        "Commands:\n" +
        "/status — vault article counts and last pull\n" +
        "/help — show this message"
    );
  });

  bot.command("help", (ctx) => {
    ctx.reply(
      "Usage:\n\n" +
        "• Text message → query the wiki vault\n" +
        "• URL (http/https) → fetch, convert to markdown, commit to raw/\n\n" +
        "Commands:\n" +
        "/status — vault status\n" +
        "/help — this message"
    );
  });

  bot.command("status", async (ctx) => {
    const thinking = await ctx.reply("Checking vault status...");
    try {
      const result = await callClaudeWithMCP(
        "Call the vault_status tool and return the result as plain text: article counts by domain and status, and the last pull timestamp."
      );
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        thinking.message_id,
        undefined,
        result
      );
    } catch (err: any) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        thinking.message_id,
        undefined,
        `❌ Error: ${err.message}`
      );
    }
  });

  // Route text messages: URLs → ingest, everything else → query
  bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim();

    if (/^https?:\/\//i.test(text)) {
      await handleIngest(ctx, text);
    } else {
      await handleQuery(ctx, text);
    }
  });

  bot.catch((err: any) => {
    console.error("Unhandled bot error:", err);
  });

  return bot;
}
