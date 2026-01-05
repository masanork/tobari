import opentype from 'opentype.js';
import fs from 'fs-extra';
// @ts-ignore
import wawoff2 from 'wawoff2';

export async function subsetFont(
    fontPath: string,
    text: string
): Promise<{ buffer: Buffer; mimeType: string }> {
    const fontBuffer = await fs.readFile(fontPath);
    const arrayBuffer = fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength);
    const font = opentype.parse(arrayBuffer);

    const glyphs: opentype.Glyph[] = [];
    const addedGlyphs = new Map<opentype.Glyph, number>();

    const addGlyphToSubset = (g: opentype.Glyph): number => {
        if (!addedGlyphs.has(g)) {
            const id = glyphs.length;
            glyphs.push(g);
            addedGlyphs.set(g, id);
            return id;
        }
        return addedGlyphs.get(g)!;
    };

    // Always add .notdef
    addGlyphToSubset(font.glyphs.get(0));

    // Dedup and extract characters
    const uniqueChars = Array.from(new Set(text));
    for (const char of uniqueChars) {
        const glyph = font.charToGlyph(char);
        addGlyphToSubset(glyph);
    }

    const subset = new opentype.Font({
        familyName: 'TobariSubset',
        styleName: 'Regular',
        unitsPerEm: font.unitsPerEm,
        ascender: font.ascender,
        descender: font.descender,
        glyphs: glyphs
    });

    const subsetBuffer = subset.toArrayBuffer();
    const woff2Buffer = await wawoff2.compress(new Uint8Array(subsetBuffer));

    return {
        buffer: Buffer.from(woff2Buffer),
        mimeType: 'font/woff2'
    };
}

export function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
