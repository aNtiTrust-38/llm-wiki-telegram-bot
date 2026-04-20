import { Telegraf } from "telegraf";
import { handleQuery } from "./handlers/query";
import { handleIngest } from "./handlers/ingest";
import { getVaultStatus } from "./mcp";

// Static help text — shown by /start and /help. Both commands return the
// same message by design: new users see the full capability surface up
// front, returning users get a refresher without hunting for a separate
// command. The two interaction modes (query, URL ingest) are both named
// explicitly so URL ingest is not a feature users only discover by trying
// (v1.8 §4 discoverability fix).
const HELP_TEXT =
  "llm-wiki bot\n\n" +
  "• Querying — send any text message and I'll search your knowledge vault.\n" +
  "• Ingesting — send any URL starting with http:// or https:// and I'll capture " +
  "the page to your raw/ folder for processing by the Ingest Agent.\n\n" +
  "Commands:\n" +
  "/status — vault stats (note counts, last MCP refresh)\n" +
  "/help — this message\n" +
  "/start — same as /help";

export function createBot(): Telegraf {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

  // Auth gate — silently drop messages from unauthorized chat IDs
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    if (chatId !== process.env.TELEGRAM_ALLOWED_CHAT_ID) return;
    return next();
  });

  bot.command("start", (ctx) => {
    ctx.reply(HELP_TEXT);
  });

  bot.command("help", (ctx) => {
    ctx.reply(HELP_TEXT);
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
