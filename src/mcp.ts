import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function callMCPTool(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  const res = await fetch(process.env.MCP_SERVER_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) {
    throw new Error(`MCP server error: ${res.status} ${res.statusText}`);
  }

  const data: any = await res.json();

  if (data.error) {
    throw new Error(`MCP tool error: ${JSON.stringify(data.error)}`);
  }

  // MCP returns result.content[{type:"text", text:"..."}]
  const content = data.result?.content;
  if (Array.isArray(content) && content.length > 0) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }

  return typeof data.result === "string"
    ? data.result
    : JSON.stringify(data.result, null, 2);
}

export async function queryVault(userMessage: string): Promise<string> {
  // Step 1: search the vault
  const searchResults = await callMCPTool("search_vault", {
    query: userMessage,
  });

  // Step 2: synthesize with Claude
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are a knowledge assistant for KP's personal wiki vault.
You will be given search results from the vault. Use them to answer the question.
If the results are empty or irrelevant, say so clearly — do not make things up.
Keep answers concise and in plain text suitable for Telegram (no markdown headers, no HTML).`,
    messages: [
      {
        role: "user",
        content: `Vault search results:\n\n${searchResults}\n\n---\n\nQuestion: ${userMessage}`,
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return text || "No response generated.";
}

export async function getVaultStatus(): Promise<string> {
  return await callMCPTool("vault_status", {});
}
