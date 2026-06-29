/**
 * Forced-condition assertions for the v1.12 /help_expiration command.
 *
 * Run: npx ts-node scripts/assert-help-expiration.ts
 *
 * Maker-side proof (the fresh-checker independently re-induces against the live
 * bot). All network is disabled — globalThis.fetch throws and bot.telegram.callApi
 * is stubbed to capture outgoing replies — so this harness makes ZERO external
 * calls and cannot hang. Updates are fed through the real Telegraf middleware
 * chain (auth gate + command router) via bot.handleUpdate, so routing, the
 * single-user auth gate, and command-token precision are all exercised exactly
 * as in production.
 */

// Env must be present before importing bot.ts (index.ts gates on these, and
// mcp.ts reads them at import time). Values are deliberately inert.
process.env.TELEGRAM_BOT_TOKEN = "test:token";
process.env.TELEGRAM_ALLOWED_CHAT_ID = "12345";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.MCP_SERVER_URL = "http://127.0.0.1:1/mcp";
process.env.GITHUB_TOKEN = "test";
process.env.GITHUB_REPO = "test/test";

// Hard-disable all network so a near-miss that routes to the query handler
// fails fast (and is caught) instead of reaching api.anthropic.com / MCP.
(globalThis as any).fetch = async () => {
  throw new Error("network-disabled-in-harness");
};

import { Telegram } from "telegraf";
import { createBot, EXPIRY_HELP_TEXT } from "../src/bot";

const ALLOWED = 12345;
const STRANGER = 99999;

type Captured = { method: string; payload: any };

// Override the Telegram client at the prototype level — every outgoing API call
// (sendMessage/editMessageText/deleteMessage) is captured, none reaches the
// network. Prototype-level is the reliable interception point: instance-level
// assignment gets bypassed by Telegraf's internal dispatch.
let captured: Captured[] = [];
(Telegram.prototype as any).callApi = async function (method: string, payload: any) {
  captured.push({ method, payload });
  // handleQuery reads .message_id off the "Searching vault..." reply.
  return { message_id: captured.length, date: 0, chat: { id: payload?.chat_id }, text: payload?.text };
};

function buildBot() {
  captured = [];
  const bot = createBot();
  // Avoid any getMe round-trip during command matching.
  (bot as any).botInfo = {
    id: 1,
    is_bot: true,
    username: "testbot",
    first_name: "test",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  return { bot, captured };
}

let seq = 100;
function commandUpdate(text: string, chatId: number) {
  seq += 1;
  return {
    update_id: seq,
    message: {
      message_id: seq,
      date: 1_700_000_000,
      chat: { id: chatId, type: "private" },
      from: { id: chatId, is_bot: false, first_name: "Test" },
      text,
      // First token is the bot command — mirrors what Telegram sends.
      entities: [{ type: "bot_command", offset: 0, length: text.split(/\s|$/)[0].length }],
    },
  };
}

function sentTexts(captured: Captured[]): string[] {
  return captured.filter((c) => c.method === "sendMessage").map((c) => c.payload?.text);
}

const results: { name: string; pass: boolean; detail: string }[] = [];
function assert(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
}

async function main() {
  // ---- A1: exact command from the allowed chat returns the procedure ----
  {
    const { bot, captured } = buildBot();
    await bot.handleUpdate(commandUpdate("/help_expiration", ALLOWED) as any);
    const texts = sentTexts(captured);
    assert(
      "A1a /help_expiration returns exactly one reply",
      texts.length === 1,
      `replies=${texts.length}`
    );
    assert(
      "A1b reply is EXPIRY_HELP_TEXT verbatim",
      texts[0] === EXPIRY_HELP_TEXT,
      texts[0] === EXPIRY_HELP_TEXT ? "match" : `got: ${JSON.stringify(texts[0])?.slice(0, 80)}`
    );
  }

  // ---- A2: same command from a non-allowed chat gets nothing (auth gate) ----
  {
    const { bot, captured } = buildBot();
    await bot.handleUpdate(commandUpdate("/help_expiration", STRANGER) as any);
    assert(
      "A2 non-allowed chat gets zero replies (single-user gate)",
      captured.length === 0,
      `captured=${captured.length}`
    );
  }

  // ---- A3: distinct command /help does NOT return the expiry text ----
  {
    const { bot, captured } = buildBot();
    await bot.handleUpdate(commandUpdate("/help", ALLOWED) as any);
    const texts = sentTexts(captured);
    assert(
      "A3 /help does not trigger the expiry handler",
      !texts.includes(EXPIRY_HELP_TEXT) && texts.length === 1,
      `replies=${texts.length}, expiryLeaked=${texts.includes(EXPIRY_HELP_TEXT)}`
    );
  }

  // ---- A4: near-miss token /help_expirations must NOT match ----
  {
    const { bot, captured } = buildBot();
    try {
      await bot.handleUpdate(commandUpdate("/help_expirations", ALLOWED) as any);
    } catch {
      /* query path's disabled-network error is expected and caught */
    }
    const texts = sentTexts(captured);
    assert(
      "A4a near-miss /help_expirations does not return EXPIRY_HELP_TEXT",
      !texts.includes(EXPIRY_HELP_TEXT),
      `expiryLeaked=${texts.includes(EXPIRY_HELP_TEXT)}`
    );
    assert(
      "A4b near-miss routed to query handler (Searching vault...), not expiry",
      texts[0] === "Searching vault...",
      `first reply: ${JSON.stringify(texts[0])}`
    );
  }

  // ---- Content: all canonical rotation steps present, list-formatted, no JSON block ----
  {
    const t = EXPIRY_HELP_TEXT;
    const numbered = ["1.", "2.", "3.", "4."].every((n) => t.includes(n));
    assert("C1 ordered list 1.-4. present", numbered, numbered ? "ok" : "missing a step number");
    const tokens = [
      "n8n UI",
      "GitHub",
      "config/credential-expiry.json",
      "expires",
      "main",
      "Workflow D",
      "06:00",
      "America/Indiana/Indianapolis",
      "7-day",
    ];
    for (const tok of tokens) {
      assert(`C2 mentions "${tok}"`, t.includes(tok), t.includes(tok) ? "ok" : "MISSING");
    }
    assert("C3 not a JSON block (no leading {)", !t.trim().startsWith("{"), "ok");
    assert("C4 not prose (contains newlines / multi-line)", t.split("\n").length >= 6, `lines=${t.split("\n").length}`);
  }

  // ---- Report ----
  let failed = 0;
  for (const r of results) {
    const tag = r.pass ? "PASS" : "FAIL";
    if (!r.pass) failed += 1;
    console.log(`[${tag}] ${r.name} — ${r.detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} assertions passed.`);
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) FAILED.`);
    process.exit(1);
  }
  console.log("ALL ASSERTIONS PASS.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Harness crashed:", e);
  process.exit(1);
});
