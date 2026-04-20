import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Protocol version for the MCP Streamable HTTP transport used by /status.
// Must match a protocol version the MCP server supports; 2025-06-18 is the
// Streamable-HTTP transport version llm-wiki-mcp is known to accept.
const MCP_PROTOCOL_VERSION = "2025-06-18";

export async function queryVault(userMessage: string): Promise<string> {
  const response = await (client.beta.messages.create as Function)({
    model: "claude-sonnet-4-20250514",
    // v1.8: raised from 1024. The prior cap was truncating paragraph-level
    // answers mid-output; Telegram's own 4096-char chunking handles long
    // messages correctly downstream (see handlers/query.ts splitMessage),
    // so the upstream cap was pure waste. 4096 gives generous room for a
    // paragraph answer with citations while still terminating on runaway
    // responses. If cost becomes an issue, lower tier by tier — don't
    // drop below ~2048 or you reintroduce the truncation pathology.
    max_tokens: 4096,
    betas: ["mcp-client-2025-04-04"],
    system: `You are a knowledge assistant for KP's personal wiki vault.
Before answering, always search the vault using the available tools.
Use search_vault to find relevant articles, then get_article if you need full content.
Base your answer on what you find. If nothing relevant exists, say so clearly.
Keep answers concise and plain text for Telegram (no markdown headers).`,
    messages: [{ role: "user", content: userMessage }],
    mcp_servers: [
      {
        type: "url",
        url: process.env.MCP_SERVER_URL!,
        name: "llm-wiki",
      },
    ],
  });

  const textBlocks = (response as any).content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text);

  return textBlocks.join("\n") || "No response generated.";
}

/**
 * Return the vault_status tool output as a plain-text string for Telegram.
 *
 * v1.8: routes directly to the MCP HTTP transport instead of through the
 * Claude API. /status needs one MCP tool call and no reasoning; the former
 * implementation wrapped that call in a paid LLM round-trip, which was
 * pure waste. This implementation is:
 *   - Faster (<1s vs. ~2–4s through Claude)
 *   - Free (no Anthropic API credit)
 *   - No failure surface for LLM misinterpretation of the tool output
 *
 * Follows the MCP Streamable HTTP transport spec (protocol version
 * 2025-06-18): initialize → notifications/initialized → tools/call.
 * Session IDs returned in the initialize response are propagated to
 * subsequent requests; stateless servers can omit the header without
 * breaking the handshake.
 */
export async function getVaultStatus(): Promise<string> {
  const endpoint = process.env.MCP_SERVER_URL!;

  // 1. Initialize. Captures any Mcp-Session-Id the server emits.
  const { data: _initData, sessionId } = await mcpRequest(endpoint, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "llm-wiki-telegram-bot", version: "1.0.0" },
    },
  });

  const sessionHeaders: Record<string, string> = sessionId
    ? { "Mcp-Session-Id": sessionId }
    : {};

  // 2. notifications/initialized — required by spec; no response body.
  await mcpRequest(
    endpoint,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sessionHeaders,
  );

  // 3. tools/call for vault_status.
  const { data: toolData } = await mcpRequest(
    endpoint,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "vault_status", arguments: {} },
    },
    sessionHeaders,
  );

  const content = toolData?.result?.content;
  if (!Array.isArray(content)) {
    throw new Error(
      `Unexpected MCP response: ${JSON.stringify(toolData).slice(0, 200)}`,
    );
  }

  const text = content
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  return text || "Status unavailable.";
}

/**
 * Send one JSON-RPC request to the MCP Streamable-HTTP endpoint. Handles
 * both the JSON and Server-Sent-Events response shapes the transport
 * permits. Notifications (method starting with `notifications/`) return
 * `{ data: null, sessionId }` without attempting to parse a body.
 */
async function mcpRequest(
  endpoint: string,
  body: any,
  extraHeaders: Record<string, string> = {},
): Promise<{ data: any; sessionId: string | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...extraHeaders,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const sessionId = res.headers.get("Mcp-Session-Id");

  if (!res.ok) {
    const errText = await safeText(res);
    throw new Error(
      `MCP HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 200)}`,
    );
  }

  // Notifications: no response body to parse (server may 202 or return empty).
  if (typeof body.method === "string" && body.method.startsWith("notifications/")) {
    return { data: null, sessionId };
  }

  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    // Find the first `data:` line carrying a JSON-RPC response with our id.
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const parsed = JSON.parse(line.slice(6));
        if (
          parsed.id === body.id &&
          (parsed.result !== undefined || parsed.error !== undefined)
        ) {
          if (parsed.error) {
            throw new Error(`MCP error: ${JSON.stringify(parsed.error)}`);
          }
          return { data: parsed, sessionId };
        }
      } catch {
        // Skip malformed SSE lines silently; keep scanning.
      }
    }
    throw new Error("No valid JSON-RPC response in SSE stream");
  }

  // Fallback: JSON response.
  const data = (await res.json()) as any;
  if (data?.error) {
    throw new Error(`MCP error: ${JSON.stringify(data.error)}`);
  }
  return { data, sessionId };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
