import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('original locally bundled typography', () => {
  it.each([
    ['fira-sans', 'Fira Sans', [300, 400, 500, 600, 700]],
    ['fira-code', 'Fira Code', [400, 500, 600, 700]],
  ] as const)('preserves %s family, weights and swap behavior without remote CSS', (slug, family, weights) => {
    const layout = read('src/app/layout.tsx');
    for (const weight of weights) {
      expect(layout).toContain(`@fontsource/${slug}/latin-${weight}.css`);
      const css = read(`node_modules/@fontsource/${slug}/latin-${weight}.css`);
      expect(css).toContain(`font-family: '${family}'`);
      expect(css).toContain(`font-weight: ${weight}`);
      expect(css).toContain('font-display: swap');
      expect(css).not.toMatch(/https?:\/\//);
      expect(css).toContain(`./files/${slug}-latin-${weight}-normal.woff2`);
    }
    expect(layout).not.toContain('next/font/google');
    expect(read('src/app/globals.css')).toContain(`"${family}"`);
  });

  it('ships the complete upstream font licenses unchanged', () => {
    expect(read('public/fonts/OFL-Fira-Sans.txt')).toBe(read('node_modules/@fontsource/fira-sans/LICENSE'));
    expect(read('public/fonts/OFL-Fira-Code.txt')).toBe(read('node_modules/@fontsource/fira-code/LICENSE'));
    expect(read('public/fonts/OFL-Fira-Sans.txt')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });
});
