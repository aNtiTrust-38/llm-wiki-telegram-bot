# llm-wiki-telegram-bot

Single-user Telegram bot for querying and ingesting into [llm-wiki](https://github.com/aNtiTrust-38/llm-wiki). Deployed to Railway in long-polling mode; writes directly to the vault repo's `raw/` folder via the GitHub API.

## Architecture

```
Telegram ──▶ bot.ts ──┬──▶ handlers/query.ts ──▶ mcp.ts ──▶ Anthropic + MCP ──▶ knowledge.peacefamily.us
                      │
                      └──▶ handlers/ingest.ts ──▶ fetch ──▶ Readability ──▶ Turndown ──▶ github.ts ──▶ raw/YYYY-MM-DD-slug.md
```

### URL-ingest pipeline

Since **v1.8**, URL ingest runs a **Readability pre-pass** (`@mozilla/readability` + `jsdom`) between fetch and Turndown. Readability extracts the article body — same algorithm Firefox Reader View ships — before the HTML reaches the Markdown converter. This prevents page-chrome pollution (nav, footer, sidebar, ad links) from entering `raw/` as spurious wikilink candidates.

Pages Readability declines (single-page apps, dashboards, GitHub repo pages) fall through to a **chrome-stripping fallback** that removes known non-article selectors (`nav`, `footer`, `aside`, `[role="navigation"]`, GitHub-specific `.AppHeader` / `.UnderlineNav`, etc.) before handing the remaining DOM to Turndown.

Reference validation: `scripts/measure-rustdesk.ts` fetches `https://github.com/rustdesk/rustdesk` through the pipeline and checks output size + absence of GitHub-chrome link polluters.

## Deploy

Railway auto-deploys on merge to `main`. Verify the build on a feature branch PR before merging — production runs on long-polling and there's no staging channel.
