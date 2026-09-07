/**
 * Dependency-free parser for the flat `key: value` frontmatter used by
 * SKILL.md files. Tolerant of CRLF line endings and quoted values.
 */

export interface Frontmatter {
  /** parsed scalar values, keyed by field name */
  values: Record<string, string>;
  /** markdown body after the closing frontmatter fence */
  body: string;
}

const FENCE = "---";

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Parse the leading `---`-fenced block of a SKILL.md file.
 * Returns null when the content has no well-formed frontmatter fence.
 */
export function parseFrontmatter(content: string): Frontmatter | null {
  const normalized = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  if (!normalized.startsWith(FENCE + "\n")) {
    return null;
  }
  const rest = normalized.slice(FENCE.length + 1);
  const end = rest.indexOf("\n" + FENCE + "\n");
  if (end === -1) {
    // accept a fence closed at EOF without a trailing newline
    const eofFence = rest.indexOf("\n" + FENCE);
    if (eofFence === -1) return null;
    const rawLines = rest.slice(0, eofFence);
    const body = rest.slice(eofFence + 1 + FENCE.length);
    return { values: parseLines(rawLines), body };
  }
  const rawLines = rest.slice(0, end);
  const body = rest.slice(end + 1 + FENCE.length + 1);
  return { values: parseLines(rawLines), body };
}

function parseLines(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match) {
      values[match[1]] = stripQuotes(match[2]);
    }
  }
  return values;
}
