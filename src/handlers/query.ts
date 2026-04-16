import { Context } from "telegraf";
import { queryVault } from "../mcp";

const TELEGRAM_MAX_LENGTH = 4096;

export async function handleQuery(ctx: Context, userMessage: string): Promise<void> {
  const thinking = await ctx.reply("Searching vault...");

  try {
    const result = await queryVault(userMessage);

    if (result.length <= TELEGRAM_MAX_LENGTH) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        thinking.message_id,
        undefined,
        result
      );
    } else {
      // Delete the "Searching..." message, then send chunks
      await ctx.telegram.deleteMessage(ctx.chat!.id, thinking.message_id);
      const chunks = splitMessage(result, TELEGRAM_MAX_LENGTH);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    }
  } catch (err: any) {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      thinking.message_id,
      undefined,
      `❌ Claude API error: ${err.message}`
    );
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength * 0.5) {
      // No good newline break — split at space
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt < maxLength * 0.5) {
      // No good break at all — hard split
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
