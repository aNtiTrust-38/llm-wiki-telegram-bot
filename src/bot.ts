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
  "/help_expiration — how to rotate a credential / update its expiry\n" +
  "/help — this message\n" +
  "/start — same as /help";

// Self-contained credential-rotation procedure (v1.12). Returned verbatim by
// /help_expiration as a clean ordered list — neurodiverse-friendly recall when
// the daily expiry heads-up DM lands. Deliberately a hardcoded string: NO file
// read, NO repo dependency, NO GitHub call, so the command is instant and works
// even if every other system is down. Ground-truth source is the rotation
// procedure in llm-wiki STATE.md + the config shape in
// llm-wiki-n8n/config/credential-expiry.json; this string is reconciled against
// them and is the single edit point if the procedure ever changes (the accepted
// drift-coupling cost of self-contained help).
export const EXPIRY_HELP_TEXT =
  "🔑 Rotate a credential / update its expiry\n\n" +
  "When the daily heads-up DM warns a credential is expiring:\n\n" +
  "1. Rotate the credential at its source:\n" +
  "   • llm-n8n API key → n8n UI\n" +
  "   • llm-wiki-github / llm-wiki-n8n PATs → GitHub\n" +
  "2. Update config/credential-expiry.json in the llm-wiki-n8n repo: set that " +
  "credential's \"expires\" to the new date (YYYY-MM-DD).\n" +
  "3. Commit and push to main — the branch Workflow D reads.\n" +
  "4. Done. The next 06:00 (America/Indiana/Indianapolis) check reads the new " +
  "date automatically — no n8n redeploy, no workflow edit. The daily heads-up " +
  "stops once the date is back outside the 7-day window.";

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

  bot.command("help_expiration", (ctx) => {
    ctx.reply(EXPIRY_HELP_TEXT);
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
