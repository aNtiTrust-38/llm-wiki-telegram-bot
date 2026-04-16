import { createBot } from "./bot";

const requiredEnv = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_CHAT_ID",
  "ANTHROPIC_API_KEY",
  "MCP_SERVER_URL",
  "GITHUB_TOKEN",
  "GITHUB_REPO",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const bot = createBot();

bot.launch();
console.log("Bot is running (long-polling mode)");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
