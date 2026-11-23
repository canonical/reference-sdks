// The repository README is the source of truth for the SDK fleet.
const SECTION = /^##\s+(.+?)\s*$/;
const SDK_LINK = /\[\*\*(.+?)\*\*\]\(https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)\/?\)/;
const EXCLUDED_SECTIONS = new Set(['Utilities & Templates']);

export function parseFleet(readme) {
  const sdks = [];
  const seen = new Set();
  let category = null;
  for (const line of readme.split('\n')) {
    const heading = SECTION.exec(line);
    if (heading) {
      category = heading[1];
      continue;
    }
    if (!category || EXCLUDED_SECTIONS.has(category) || !line.startsWith('|')) continue;
    const link = SDK_LINK.exec(line);
    if (!link || seen.has(link[2].toLowerCase())) continue;
    seen.add(link[2].toLowerCase());
    sdks.push({ name: link[1], repo: link[2], category });
  }
  return sdks;
}
