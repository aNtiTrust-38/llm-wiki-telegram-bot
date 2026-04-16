import { Octokit } from "@octokit/rest";

let octokit: Octokit;

function getOctokit(): Octokit {
  if (!octokit) {
    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  return octokit;
}

export async function commitFileToRaw(
  filename: string,
  content: string
): Promise<void> {
  const ok = getOctokit();
  const [owner, repo] = process.env.GITHUB_REPO!.split("/");
  const path = `raw/${filename}`;
  const branch = process.env.GITHUB_REPO_BRANCH || "main";

  // Check if file already exists (to get SHA for update)
  let sha: string | undefined;
  try {
    const existing = await ok.repos.getContent({ owner, repo, path, ref: branch });
    if (!Array.isArray(existing.data)) {
      sha = (existing.data as any).sha;
    }
  } catch {
    // File doesn't exist — new file, no SHA needed
  }

  await ok.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: `ingest: ${filename} via Telegram bot`,
    content: Buffer.from(content).toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  });
}
