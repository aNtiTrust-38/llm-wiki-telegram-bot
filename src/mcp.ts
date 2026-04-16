import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function callClaudeWithMCP(
  userMessage: string
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are a knowledge assistant with access to KP's personal wiki vault.
Before answering any question, always search the vault using the available tools.
Use search_vault to find relevant articles, get_article to read full content.
Base your answer on what you find. If nothing relevant exists, say so clearly.
Keep answers concise and well-structured for Telegram (plain text, no markdown headers).`,
    messages: [{ role: "user", content: userMessage }],
    mcp_servers: [
      {
        type: "url",
        url: process.env.MCP_SERVER_URL!,
        name: "llm-wiki",
      },
    ],
  } as any);

  const textBlocks = response.content
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text);

  return textBlocks.join("\n") || "No response generated.";
}
