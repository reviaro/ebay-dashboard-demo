/**
 * Surgical edits to a dotenv file.
 *
 * `.env.local` holds the eBay client secret and the token-encryption key --
 * losing either means re-authorizing the eBay connection. So the setup script
 * never rewrites the file wholesale: it replaces exactly one line and leaves
 * every other byte, comment included, untouched.
 */

function keyPattern(key: string): RegExp {
  // Anchored at line start so `AB=` is not mistaken for `A=`, and so a
  // commented-out `#A=` is left alone.
  return new RegExp(`^${key}=.*$`, 'm');
}

export function upsertEnvValue(
  contents: string,
  key: string,
  value: string
): string {
  const line = `${key}="${value}"`;
  const pattern = keyPattern(key);

  if (pattern.test(contents)) return contents.replace(pattern, line);

  const separator = contents.length === 0 || contents.endsWith('\n') ? '' : '\n';
  return `${contents}${separator}${line}\n`;
}

export function hasEnvValue(contents: string, key: string): boolean {
  const match = contents.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) return false;

  return match[1].replace(/^["']|["']$/g, '').trim().length > 0;
}
