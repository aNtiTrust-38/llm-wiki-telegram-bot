# llm-wiki-telegram-bot

Single-user Telegram bot for querying and ingesting into [llm-wiki](https://github.com/aNtiTrust-38/llm-wiki). Deployed to Railway in long-polling mode; writes directly to the vault repo's `raw/` folder via the GitHub API; speaks MCP for both the query path (LLM-routed) and `/status` (direct tool call).

## Usage

### Access control — single-user gated

Every inbound message is gated on `TELEGRAM_ALLOWED_CHAT_ID`. Messages from any other chat ID are **silently dropped** — no reply, no error, no indication the bot saw the message. This is deliberate: the bot has write access to the vault's `raw/` folder, and an accidental share of the bot username shouldn't expose that surface.

To get your own `TELEGRAM_ALLOWED_CHAT_ID`, message the bot from your account (as the bot's owner), check the logs for your chat ID, and set it in the deployment environment.

### Interaction modes

Two modes, chosen automatically by the bot based on message content:

| You send                                  | Bot does                                                                                                    |
|-------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| Any text message (not starting with `/`)  | **Query mode.** Sends the text to Claude via the Anthropic API with the MCP vault server attached. Claude searches the vault and returns an answer, chunked if over 4096 chars. |
| A URL (starting with `http://` / `https://`) | **Ingest mode.** Fetches the URL, runs it through the Readability pre-pass, converts to Markdown, and commits to `raw/YYYY-MM-DD-slug.md` in the vault repo via the GitHub API. |

### Commands

| Command   | Does                                                                                                |
|-----------|-----------------------------------------------------------------------------------------------------|
| `/start`  | Static welcome message naming both interaction modes and listing commands. Same text as `/help`.    |
| `/help`   | Same text as `/start`.                                                                              |
| `/status` | Vault stats via MCP `vault_status` — total note count, PASS counts, tag breakdown, last pull time. **v1.8:** calls MCP directly (no Claude API round-trip). |

## Architecture

```
Telegram ──▶ bot.ts ──┬──▶ handlers/query.ts ──▶ mcp.ts::queryVault ──▶ Anthropic + MCP (LLM-routed)
                      │                                     │
                      │                                     └──▶ MCP search_vault / get_article
                      │
                      └──▶ handlers/ingest.ts ──▶ fetch ──▶ Readability ──▶ Turndown ──▶ github.ts ──▶ raw/YYYY-MM-DD-slug.md
                      │
                      └──▶ /status ──▶ mcp.ts::getVaultStatus ──▶ MCP vault_status (direct HTTP, no LLM)
```

### URL-ingest pipeline (v1.8)

The ingest path runs a **Readability pre-pass** (`@mozilla/readability` + `jsdom`) between fetch and Turndown. Readability extracts the article body — same algorithm Firefox Reader View ships — before the HTML reaches the Markdown converter. This prevents page chrome (nav, footer, sidebar, ad links, badge URLs) from entering `raw/` as spurious wikilink candidates.

Pages Readability declines (single-page apps, dashboards, GitHub repo pages) fall through to a **chrome-stripping fallback** that removes known non-article selectors (`nav`, `footer`, `aside`, `[role="navigation"]`, GitHub-specific `.AppHeader` / `.UnderlineNav`, etc.) before handing the remaining DOM to Turndown.

Reference validation: `scripts/measure-rustdesk.ts` fetches `https://github.com/rustdesk/rustdesk` through the pipeline and checks output size + absence of GitHub-chrome link polluters. Current metric: re-ingested artifact size is 1.04× the Shape-A Web Clipper reference (17,585 → 18,208 B).

### `raw/` frontmatter shape (Shape B)

Ingested files land with this minimal frontmatter:

```yaml
---
source: <URL>
ingested: <ISO 8601 timestamp>
title: "<HTML <title> contents>"
---
```

The downstream Ingest Agent in the [vault repo](https://github.com/aNtiTrust-38/llm-wiki) normalizes Shape B along with the Obsidian Web Clipper's Shape A and header-less Shape C on read. See [`docs/consumer-contracts.md` Tier 2](https://github.com/aNtiTrust-38/llm-wiki/blob/main/docs/consumer-contracts.md) and [`docs/integration-contract.md` §2](https://github.com/aNtiTrust-38/llm-wiki/blob/main/docs/integration-contract.md) for the full normalization rules.

### `/status` direct MCP path (v1.8)

Previously `/status` routed through a Claude API call that invoked the `vault_status` MCP tool — paying for LLM reasoning the command didn't need. `/status` now speaks the **MCP Streamable HTTP transport** directly:

1. `POST initialize` (with `protocolVersion: 2025-06-18`, captures any `Mcp-Session-Id`)
2. `POST notifications/initialized`
3. `POST tools/call` with `{ name: "vault_status", arguments: {} }`
4. Parse `content[].text`, return as plain text to Telegram.

Handles both `application/json` and `text/event-stream` response shapes per the MCP spec.

## Deploy

Railway auto-deploys on merge to `main`. There's no staging channel — the feature-branch PR is the verification surface. Use `npm run build` locally to catch TypeScript errors before push; the `tsc` step runs as part of the Railway build.

### Environment variables

| Variable                    | Purpose                                                                 |
|-----------------------------|-------------------------------------------------------------------------|
| `TELEGRAM_BOT_TOKEN`        | BotFather-issued token                                                  |
| `TELEGRAM_ALLOWED_CHAT_ID`  | Single-user gate; all other chats are dropped silently                  |
| `ANTHROPIC_API_KEY`         | Used by query path (not by `/status` anymore)                           |
| `MCP_SERVER_URL`            | Public MCP endpoint (e.g. `https://knowledge.peacefamily.us/mcp`)       |
| `GITHUB_TOKEN`              | Octokit token with write access to the `raw/` folder                    |
| `GITHUB_REPO`               | `owner/repo` — target repo for URL ingest                               |
| `GITHUB_REPO_BRANCH`        | Optional; defaults to `main`                                            |

## Known limitations

- **Query model fixed at `claude-sonnet-4-20250514`.** Not configurable without a code edit. If you want Haiku or Opus, edit `src/mcp.ts::queryVault`.
- **URL ingest commits immediately.** No staging, no preview, no "are you sure?" confirmation. If you paste a URL you meant to quote into a message, it will be ingested. This is deliberate for the single-user use case but is the one sharp edge.
- **Telegram's 4096-character chunking** handles long query answers by splitting at newlines or spaces near the boundary. Code blocks split across chunks lose their fencing; if you're asking a question that's likely to return code, ask for shorter answers or use the web UI.
- **No rate-limiting on URL ingest.** If you paste 20 URLs in quick succession, the bot will try to process all of them sequentially. Rate-limiting would be a v1.9 item if abuse ever becomes a concern (single-user gate makes this unlikely).
- **Bot sessions do not persist memory across invocations.** Each query is a fresh Claude call; the bot doesn't maintain a conversation history. If you want follow-up reasoning on an earlier answer, the web UI with the same MCP connector is the better path.

## Development

```bash
npm install
cp .env.example .env   # fill in env vars
npm run dev            # ts-node, long-polling, live reload on save
```

Type-check without running:
```bash
npx tsc --noEmit
```

Validate the Readability pipeline against the rustdesk reference:
```bash
npx ts-node scripts/measure-rustdesk.ts
```
