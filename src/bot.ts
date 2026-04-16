import { Telegraf } from "telegraf";
import { handleQuery } from "./handlers/query";
import { handleIngest } from "./handlers/ingest";
import { getVaultStatus } from "./mcp";

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
    try {
      const status = await getVaultStatus();
      await ctx.reply(status);
    } catch (err: any) {
      await ctx.reply(`❌ Status error: ${err.message}`);
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
