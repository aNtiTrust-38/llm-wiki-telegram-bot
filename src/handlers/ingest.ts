import { Context } from "telegraf";
import TurndownService from "turndown";
import { commitFileToRaw } from "../github";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Strip noisy elements before conversion
turndown.remove(["nav", "footer", "header", "aside", "script", "style"]);

export async function handleIngest(ctx: Context, url: string): Promise<void> {
  const status = await ctx.reply(`⏳ Fetching ${url}...`);

  try {
    // Fetch with 15s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; llm-wiki-bot/1.0; +https://github.com/aNtiTrust-38/llm-wiki-telegram-bot)",
        },
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        await editStatus(ctx, status.message_id, "❌ Could not fetch that URL (timeout or unreachable).");
        return;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      await editStatus(ctx, status.message_id, `❌ Fetch failed: HTTP ${res.status}`);
      return;
    }

    const html = await res.text();

    // Extract title from HTML
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch
      ? titleMatch[1].replace(/\s+/g, " ").trim()
      : new URL(url).hostname;

    // Convert to markdown
    const markdown = turndown.turndown(html);

    // Build filename
    const today = new Date().toISOString().slice(0, 10);
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 60)
      .replace(/-+$/, "");
    const filename = `${today}-${slug}.md`;

    // Build file content with frontmatter
    const content = [
      "---",
      `source: ${url}`,
      `ingested: ${new Date().toISOString()}`,
      `title: "${title.replace(/"/g, '\\"')}"`,
      "---",
      "",
      markdown,
    ].join("\n");

    await editStatus(ctx, status.message_id, `⏳ Committing raw/${filename}...`);

    await commitFileToRaw(filename, content);

    await editStatus(
      ctx,
      status.message_id,
      `✅ Ingested: raw/${filename}\nTitle: ${title}\nThe MCP server will index it within 15 minutes.`
    );
  } catch (err: any) {
    await editStatus(ctx, status.message_id, `❌ Error: ${err.message}`);
  }
}

async function editStatus(ctx: Context, messageId: number, text: string): Promise<void> {
  await ctx.telegram.editMessageText(ctx.chat!.id, messageId, undefined, text);
}
