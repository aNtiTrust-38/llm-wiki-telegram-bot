// Predict-vs-actual harness for the v1.8 Readability pre-pass.
//
// Fetches https://github.com/rustdesk/rustdesk, runs it through the new
// extractArticleMarkdown() pipeline, and prints byte counts to compare against
// the existing Web-Clipper Shape-A reference (17,585 bytes).
//
// Pass condition per sprint-v1.7.1-plus-v1.8-validator-bot.md §1:
// "Same order of magnitude is the pass condition."
//
// This script is throwaway — not shipped as part of the bot runtime, only
// used to validate the PR locally before Railway build + deploy.

import { extractArticleMarkdown } from "../src/handlers/ingest";

const URL = "https://github.com/rustdesk/rustdesk";
const REFERENCE_BYTES = 17585; // Shape-A Web Clipper version

async function main() {
  console.log(`Fetching ${URL} ...`);
  const res = await fetch(URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; llm-wiki-bot/1.0; measure-harness)",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const html = await res.text();
  console.log(`Raw HTML: ${html.length.toLocaleString()} bytes`);

  const { title, markdown } = extractArticleMarkdown(html, URL);
  const body = new Blob([markdown]).size; // UTF-8 byte count

  // Simulate the full raw/ artifact by prepending frontmatter exactly as
  // the bot would commit it.
  const artifact = [
    "---",
    `source: ${URL}`,
    `ingested: ${new Date().toISOString()}`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    "---",
    "",
    markdown,
  ].join("\n");
  const artifactBytes = new Blob([artifact]).size;

  console.log();
  console.log(`Title: ${title}`);
  console.log();
  console.log(`Markdown body:    ${body.toLocaleString()} bytes`);
  console.log(`Full raw/ artifact: ${artifactBytes.toLocaleString()} bytes`);
  console.log(`Reference (Shape-A Web Clipper): ${REFERENCE_BYTES.toLocaleString()} bytes`);
  console.log();

  const ratio = artifactBytes / REFERENCE_BYTES;
  console.log(`Ratio vs. reference: ${ratio.toFixed(2)}x`);
  if (ratio >= 0.1 && ratio <= 10) {
    console.log("✓ PASS: same order of magnitude as reference.");
  } else {
    console.log("✗ FAIL: not same order of magnitude.");
    process.exit(1);
  }

  // Spot-check for known chrome link pollution. Any of these in the output
  // means the pipeline let nav/footer content through.
  const polluters = [
    "/pulls",
    "/issues",
    "/actions",
    "/security",
    "/settings",
    "About GitHub",
    "Terms of service",
    "docs.github.com",
    "github.blog",
  ];
  const found = polluters.filter((needle) => markdown.includes(needle));
  console.log();
  if (found.length === 0) {
    console.log("✓ No known GitHub chrome polluters detected in output.");
  } else {
    console.log(`✗ Chrome polluters still present: ${JSON.stringify(found)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
