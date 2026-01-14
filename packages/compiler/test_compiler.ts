import { parseMarkdown } from './src/index';
import { test, expect } from 'bun:test';

test('Compiler sanity check', () => {
    const md = '# Hello\n- [text:name] Name';
    const result = parseMarkdown(md);
    expect(result.html).toContain('<h1>Hello</h1>');
    expect(result.html).toContain('input type="text"');
    expect(result.html).toContain('data-json-path="name"');
});
