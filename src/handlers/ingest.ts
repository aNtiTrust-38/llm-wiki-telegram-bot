import { Context } from "telegraf";
import TurndownService from "turndown";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { commitFileToRaw } from "../github";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Strip noisy elements before conversion. Retained as a belt-and-braces
// pass for HTML fragments that still contain chrome after Readability
// extraction, or for the fallback path when Readability declines.
turndown.remove(["nav", "footer", "header", "aside", "script", "style"]);

// Selectors used by turndownWithChromeStripped to prune obvious page chrome
// before Turndown sees it. Structural first (semantic tags + ARIA roles),
// then class-based, then site-specific. Matches the sprint-v1.8 spec.
const CHROME_SELECTORS = [
  // Media / script / frames
  "script", "style", "noscript", "iframe",
  // Semantic page chrome
  "nav", "header", "footer", "aside",
  // ARIA roles for page chrome (survives CSS-framework class churn)
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  // Common non-article class conventions
  ".advertisement", ".sidebar", ".menu",
  // GitHub-specific chrome (the rustdesk/rustdesk case that motivated §1)
  ".Header", ".footer", ".AppHeader", ".UnderlineNav",
  "github-feature-preview-dialog",
];

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
    const { title, markdown } = extractArticleMarkdown(html, url);

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

/**
 * Extract the article body from a fetched HTML page and convert it to Markdown.
 *
 * Two paths:
 *  1. Readability (preferred). Uses Mozilla's own Reader-View algorithm —
 *     same code path Firefox ships with. Scores DOM nodes by text density
 *     and content heuristics, keeps the article body, drops everything else.
 *     Works well on articles, blog posts, news, docs. Also works on the
 *     majority of "readerable" pages per `isProbablyReaderable`.
 *  2. Chrome-stripping fallback. For pages Readability declines (typically
 *     GitHub repo pages, app dashboards, single-page apps), strip known
 *     chrome selectors before handing the remaining DOM to Turndown. This
 *     is the rustdesk/rustdesk case that motivated the v1.8 headliner —
 *     previous versions handed the full HTML to Turndown and got
 *     nav/sidebar/footer link pollution in raw/.
 */
export function extractArticleMarkdown(
  html: string,
  url: string,
): { title: string; markdown: string } {
  // JSDOM gets `url` so relative <a href> resolve against the page origin
  // rather than file:// placeholders.
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // Title fallback — Readability sets it when successful; otherwise extract
  // from <title> directly, otherwise from the URL hostname.
  const titleFromTag = doc.querySelector("title")?.textContent?.trim();
  const fallbackTitle = titleFromTag || new URL(url).hostname;

  // Path 1: Readability. `isProbablyReaderable` is a cheap pre-check; without
  // it Readability will still try, but may throw on malformed docs.
  if (isProbablyReaderable(doc)) {
    try {
      // Clone the document — Readability.parse() mutates its input.
      const cloned = new JSDOM(html, { url }).window.document;
      const reader = new Readability(cloned);
      const article = reader.parse();
      if (article && article.content) {
        return {
          title: (article.title || fallbackTitle).replace(/\s+/g, " ").trim(),
          markdown: turndown.turndown(article.content),
        };
      }
    } catch {
      // Fall through to chrome-stripping path below.
    }
  }

  // Path 2: strip chrome, then Turndown the remainder. Order matters —
  // removing semantic chrome first reduces the work for class-based rules.
  for (const sel of CHROME_SELECTORS) {
    doc.querySelectorAll(sel).forEach((el) => el.remove());
  }

  return {
    title: fallbackTitle.replace(/\s+/g, " ").trim(),
    markdown: turndown.turndown(doc.body?.innerHTML ?? ""),
  };
}

async function editStatus(ctx: Context, messageId: number, text: string): Promise<void> {
  await ctx.telegram.editMessageText(ctx.chat!.id, messageId, undefined, text);
}
