import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function queryVault(userMessage: string): Promise<string> {
  const response = await (client.beta.messages.create as Function)({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
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

export async function getVaultStatus(): Promise<string> {
  const response = await (client.beta.messages.create as Function)({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    betas: ["mcp-client-2025-04-04"],
    system: "Call the vault_status tool and return the result as plain text.",
    messages: [{ role: "user", content: "vault status" }],
    mcp_servers: [
      {
        type: "url",
        url: process.env.MCP_SERVER_URL!,
        name: "llm-wiki",
      },
    ],
  });

  const text = (response as any).content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  return text || "Status unavailable.";
}
