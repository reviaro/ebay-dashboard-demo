import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';
import { ReportMarkdown } from './TaskDetailModal';

const render = (md: string) => parse(renderToStaticMarkup(<ReportMarkdown>{md}</ReportMarkdown>));
const resourceSelector = 'img, script, iframe, object, embed, audio, video, source, track, link, style, svg, meta, base';

const imageReport = `![inline](https://resources.example.test/pixel?data=private)

![reference][tracking]

[![linked image](https://resources.example.test/linked)](https://example.com/citation)

![](//resources.example.test/protocol-relative)

![local](/api/resource)

![data](data:image/png;base64,aGVsbG8=)

[tracking]: https://resources.example.test/reference
`;

describe('ReportMarkdown', () => {
  it('preserves GFM tables, headings, lists, code and emphasis', () => {
    const dom = render('## Findings\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- **Result** with `code`');
    expect(dom.querySelector('h2')?.text).toBe('Findings');
    expect(dom.querySelectorAll('td').map(cell => cell.text)).toEqual(['1', '2']);
    expect(dom.querySelector('li strong')?.text).toBe('Result');
    expect(dom.querySelector('code')?.text).toBe('code');
  });

  it('replaces all Markdown images with readable text without resource nodes or preloads', () => {
    const dom = render(imageReport);
    expect(dom.querySelectorAll(resourceSelector)).toHaveLength(0);
    expect(dom.querySelectorAll('[src], [srcset], [poster]')).toHaveLength(0);
    expect(dom.toString()).not.toContain('resources.example.test');
    expect(dom.toString()).not.toContain('/api/resource');
    expect(dom.toString()).not.toContain('data:image');
    expect(dom.text).toContain('[Image omitted: inline]');
    expect(dom.text).toContain('[Image omitted: reference]');
    expect(dom.text).toContain('[Image omitted: linked image]');
    expect(dom.text).toContain('[Image omitted]');
    expect(dom.querySelectorAll('a')).toHaveLength(1);
    expect(dom.querySelector('a')?.getAttribute('href')).toBe('https://example.com/citation');
  });

  it('skips raw HTML resource and script elements', () => {
    const dom = render(`Safe text

<script src="https://resources.example.test/script.js">alert(1)</script>

<img src="https://resources.example.test/pixel" onerror="alert(1)">

<iframe src="https://resources.example.test/frame"></iframe>

<video poster="https://resources.example.test/poster"><source src="https://resources.example.test/video"></video>

<audio src="https://resources.example.test/audio"></audio>

<object data="https://resources.example.test/object"></object>

<svg><image href="https://resources.example.test/svg" /></svg>

<link rel="stylesheet" href="https://resources.example.test/style.css">

<style>@import url(https://resources.example.test/import.css);</style>

<meta http-equiv="refresh" content="0;url=https://resources.example.test/redirect">

<base href="https://resources.example.test/">

<a href="https://resources.example.test/raw-link">raw link</a>`);
    expect(dom.querySelectorAll(resourceSelector)).toHaveLength(0);
    expect(dom.querySelectorAll('[src], [srcset], [poster], [href]')).toHaveLength(0);
    expect(dom.text).toContain('Safe text');
  });

  it.each([
    'javascript:alert%281%29',
    'data:text/html;base64,aGVsbG8=',
    'vbscript:msgbox%281%29',
    'file:///etc/passwd',
    'ftp://example.com/file',
    '//example.com/path',
    '/api/sync',
    '../settings',
    '#fragment',
    'https://user:password@example.com/private',
    'https://user@example.com/private',
    'https://',
  ])('renders unsafe or non-absolute citation %s as plain text', (url) => {
    const dom = render(`[citation](${url})`);
    expect(dom.querySelectorAll('a')).toHaveLength(0);
    expect(dom.text).toBe('citation');
  });

  it('preserves explicit HTTP(S) citations with no opener or referrer', () => {
    const dom = render('[HTTPS citation](https://example.com/report?q=value#section) [HTTP citation](http://example.org/archive) <https://example.net/source>');
    const links = dom.querySelectorAll('a');
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      'https://example.com/report?q=value#section',
      'http://example.org/archive',
      'https://example.net/source',
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.getAttribute('referrerPolicy')).toBe('no-referrer');
    }
  });

  it('escapes image alt text instead of turning it into markup', () => {
    const dom = render('![<img src="https://resources.example.test/alt">](https://resources.example.test/image)');
    expect(dom.querySelectorAll(resourceSelector)).toHaveLength(0);
    expect(dom.text).toContain('<img src="https://resources.example.test/alt">');
  });
});
