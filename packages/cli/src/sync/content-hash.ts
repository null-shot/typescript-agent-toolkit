/**
 * Fast, deterministic content hash for file-level change detection.
 *
 * Uses djb2 variant — same algorithm runs in both Node.js (CLI) and
 * Cloudflare Workers (CodeBox) without any external dependencies, so
 * comparing hashes across the wire is always reliable.
 *
 * NOT cryptographically secure; used only to detect whether file content
 * has changed between CLI sessions.
 */
export function hashContent(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    // djb2: h = h * 33 ^ c  (unsigned 32-bit)
    h = (((h << 5) + h) ^ content.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Map of file path → content hash for a set of local or remote files. */
export type FileHashMap = Record<string, string>;
