export function escapeHtml(str: string): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function parseAttribute(attrStr: string | undefined, key: string): string | null {
    if (!attrStr) return null;
    const regex = new RegExp(`${key}="([^"]*)"`);
    const match = attrStr.match(regex);
    if (match) return match[1];
    
    // Also check for unquoted boolean-like or simple values if needed, 
    // but v1 parser mostly relied on quoted attributes for extracted values.
    return null;
}

export function hasAttribute(attrStr: string | undefined, key: string): boolean {
    if (!attrStr) return false;
    // Check for key="value" or just key
    if (attrStr.includes(key + '=')) return true;
    const regex = new RegExp(`\\b${key}\\b`);
    return regex.test(attrStr);
}
