import opentype from 'opentype.js';
import fs from 'fs-extra';
// @ts-ignore
import wawoff2 from 'wawoff2';

function getUShort(view: DataView, offset: number) { return view.getUint16(offset, false); }
function getULong(view: DataView, offset: number) { return view.getUint32(offset, false); }
function getUInt24(view: DataView, offset: number) {
    return (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2);
}

interface IVSMap {
    [vs: number]: { [base: number]: number }; // VS -> Base -> GID
}

// Minimal CMAP Format 14 Parser
function parseCmapFormat14(buffer: ArrayBuffer): IVSMap | null {
    const view = new DataView(buffer);
    const numTables = getUShort(view, 4);
    let cmapOffset = 0;

    for (let i = 0; i < numTables; i++) {
        const p = 12 + i * 16;
        const tag = String.fromCharCode(view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3));
        if (tag === 'cmap') {
            cmapOffset = getULong(view, p + 8);
            break;
        }
    }
    if (!cmapOffset) return null;

    const numSubtables = getUShort(view, cmapOffset + 2);
    let subtableOffset = 0;
    for (let i = 0; i < numSubtables; i++) {
        const p = cmapOffset + 4 + i * 8;
        const offset = getULong(view, p + 4);
        const subTableStart = cmapOffset + offset;
        if (subTableStart + 2 > view.byteLength) continue;
        const format = getUShort(view, subTableStart);
        if (format === 14) {
            subtableOffset = subTableStart;
            break;
        }
    }
    if (!subtableOffset) return null;

    const numVarSelectorRecords = getULong(view, subtableOffset + 6);
    const map: IVSMap = {};

    for (let i = 0; i < numVarSelectorRecords; i++) {
        const p = subtableOffset + 10 + i * 11;
        const varSelector = getUInt24(view, p);
        const nonDefaultUVSOffset = getULong(view, p + 7);
        if (!map[varSelector]) map[varSelector] = {};
        if (nonDefaultUVSOffset !== 0) {
            const ndOffset = subtableOffset + nonDefaultUVSOffset;
            const numUVSMappings = getULong(view, ndOffset);
            for (let j = 0; j < numUVSMappings; j++) {
                const mp = ndOffset + 4 + j * 5;
                const unicodeValue = getUInt24(view, mp);
                const glyphID = getUShort(view, mp + 3);
                map[varSelector][unicodeValue] = glyphID;
            }
        }
    }
    return map;
}

function isVariationSelector(codepoint: number): boolean {
    return (codepoint >= 0xFE00 && codepoint <= 0xFE0F) || (codepoint >= 0xE0100 && codepoint <= 0xE01EF);
}

function calculateChecksum(buffer: Uint8Array): number {
    let sum = 0;
    const nLongs = Math.floor(buffer.length / 4);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    for (let i = 0; i < nLongs; i++) { sum = (sum + view.getUint32(i * 4, false)) >>> 0; }
    const left = buffer.length % 4;
    if (left > 0) {
        let val = 0;
        for (let i = 0; i < left; i++) { val = (val << 8) + (buffer[nLongs * 4 + i] ?? 0); }
        val = val << (8 * (4 - left));
        sum = (sum + val) >>> 0;
    }
    return sum;
}

function generateCmapFormat12(mappings: { code: number, gid: number }[]): Uint8Array {
    const uniqueMap = new Map<number, number>();
    for (const m of mappings) if (!uniqueMap.has(m.code)) uniqueMap.set(m.code, m.gid);
    const sorted = Array.from(uniqueMap.entries()).map(([code, gid]) => ({ code, gid })).sort((a, b) => a.code - b.code);
    const groups: { start: number, end: number, gid: number }[] = [];
    if (sorted.length > 0) {
        let current = { start: sorted[0]!.code, end: sorted[0]!.code, gid: sorted[0]!.gid };
        for (let i = 1; i < sorted.length; i++) {
            const m = sorted[i]!;
            if (m.code === current.end + 1 && m.gid === current.gid + (m.code - current.start)) { current.end = m.code; }
            else { groups.push(current); current = { start: m.code, end: m.code, gid: m.gid }; }
        }
        groups.push(current);
    }
    const size = 16 + 12 * groups.length;
    const buffer = new Uint8Array(size);
    const view = new DataView(buffer.buffer);
    view.setUint16(0, 12, false);
    view.setUint32(4, size, false);
    view.setUint32(12, groups.length, false);
    let offset = 16;
    for (const g of groups) { view.setUint32(offset, g.start, false); view.setUint32(offset + 4, g.end, false); view.setUint32(offset + 8, g.gid, false); offset += 12; }
    return buffer;
}

function generateCmapFormat14(ivsRecords: { vs: number, code: number, gid: number }[]): Uint8Array {
    const vsMap = new Map<number, { code: number, gid: number }[]>();
    const seen = new Set<string>();
    for (const rec of ivsRecords) {
        const key = `${rec.vs}-${rec.code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!vsMap.has(rec.vs)) vsMap.set(rec.vs, []);
        vsMap.get(rec.vs)!.push(rec);
    }
    const sortedVS = Array.from(vsMap.keys()).sort((a, b) => a - b);
    let size = 10 + 11 * sortedVS.length;
    const uvsTableSizes: number[] = [];
    for (const vs of sortedVS) {
        const mappings = vsMap.get(vs)!;
        const tableSize = 4 + 5 * mappings.length;
        uvsTableSizes.push(tableSize);
        size += tableSize;
    }
    const buffer = new Uint8Array(size);
    const view = new DataView(buffer.buffer);
    view.setUint16(0, 14, false);
    view.setUint32(2, size, false);
    view.setUint32(6, sortedVS.length, false);
    let subTableOffset = 10 + 11 * sortedVS.length;
    let offset = 10;
    for (let i = 0; i < sortedVS.length; i++) {
        const vs = sortedVS[i]!;
        const uvsSize = uvsTableSizes[i]!;
        view.setUint8(offset, (vs >> 16) & 0xFF); view.setUint8(offset + 1, (vs >> 8) & 0xFF); view.setUint8(offset + 2, vs & 0xFF);
        view.setUint32(offset + 7, subTableOffset, false);
        offset += 11; subTableOffset += uvsSize;
    }
    for (let i = 0; i < sortedVS.length; i++) {
        const mappings = vsMap.get(sortedVS[i]!)!.sort((a, b) => a.code - b.code);
        view.setUint32(offset, mappings.length, false);
        offset += 4;
        for (const m of mappings) {
            view.setUint8(offset, (m.code >> 16) & 0xFF); view.setUint8(offset + 1, (m.code >> 8) & 0xFF); view.setUint8(offset + 2, m.code & 0xFF);
            view.setUint16(offset + 3, m.gid, false);
            offset += 5;
        }
    }
    return buffer;
}

function injectCustomTables(subsetBuffer: ArrayBuffer, customTables: Record<string, Uint8Array>): ArrayBuffer {
    const view = new DataView(subsetBuffer);
    const numTables = view.getUint16(4, false);
    const tablesMap = new Map<string, Uint8Array>();
    for (let i = 0; i < numTables; i++) {
        const p = 12 + i * 16;
        const tag = String.fromCharCode(view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3));
        tablesMap.set(tag, new Uint8Array(subsetBuffer, view.getUint32(p + 8, false), view.getUint32(p + 12, false)));
    }
    for (const [tag, data] of Object.entries(customTables)) tablesMap.set(tag, data);
    const sortedTags = Array.from(tablesMap.keys()).sort();
    const tableDirSize = 12 + 16 * sortedTags.length;
    let totalSize = tableDirSize + 1024;
    for (const data of tablesMap.values()) totalSize += (data.length + 4);
    const newFont = new Uint8Array(totalSize);
    const nfv = new DataView(newFont.buffer);
    newFont.set(new Uint8Array(subsetBuffer, 0, 12), 0);
    nfv.setUint16(4, sortedTags.length, false);
    let writePtr = tableDirSize;
    let headOffset = 0;
    for (let i = 0; i < sortedTags.length; i++) {
        const tag = sortedTags[i]!;
        const data = tablesMap.get(tag)!;
        const dirOffset = 12 + i * 16;
        while (writePtr % 4 !== 0) writePtr++;
        newFont.set(data, writePtr);
        for (let j = 0; j < 4; j++) nfv.setUint8(dirOffset + j, tag.charCodeAt(j));
        nfv.setUint32(dirOffset + 8, writePtr, false);
        nfv.setUint32(dirOffset + 12, data.length, false);
        nfv.setUint32(dirOffset + 4, calculateChecksum(newFont.subarray(writePtr, writePtr + data.length)), false);
        if (tag === 'head') headOffset = writePtr;
        writePtr += data.length;
    }
    if (headOffset) {
        nfv.setUint32(headOffset + 8, 0, false);
        const adjustment = (0xB1B0AFBA - calculateChecksum(newFont.subarray(0, writePtr))) >>> 0;
        nfv.setUint32(headOffset + 8, adjustment, false);
    }
    return newFont.slice(0, writePtr).buffer;
}

function injectNativeCmap(subsetBuffer: ArrayBuffer, unicodeMap: { code: number, gid: number }[], ivsRecords: { vs: number, code: number, gid: number }[]): ArrayBuffer {
    const view = new DataView(subsetBuffer);
    const numTables = view.getUint16(4, false);
    let cmapOffset = 0, cmapLength = 0;
    for (let i = 0; i < numTables; i++) {
        const p = 12 + i * 16;
        const tag = String.fromCharCode(view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3));
        if (tag === 'cmap') { cmapOffset = view.getUint32(p + 8, false); cmapLength = view.getUint32(p + 12, false); break; }
    }
    if (!cmapOffset) return subsetBuffer;
    const oldCmapView = new DataView(subsetBuffer, cmapOffset, cmapLength);
    const numSubtables = oldCmapView.getUint16(2, false);
    const subtables: { platform: number; encoding: number; data: Uint8Array; }[] = [];
    let f4Data: Uint8Array | null = null;
    for (let i = 0; i < numSubtables; i++) {
        const p = 4 + i * 8;
        const off = oldCmapView.getUint32(p + 4, false);
        if (oldCmapView.getUint16(off, false) === 4) { f4Data = new Uint8Array(subsetBuffer, cmapOffset + off, oldCmapView.getUint16(off + 2, false)); break; }
    }
    if (f4Data) { subtables.push({ platform: 0, encoding: 3, data: f4Data }); subtables.push({ platform: 3, encoding: 1, data: f4Data }); }
    subtables.push({ platform: 0, encoding: 4, data: generateCmapFormat12(unicodeMap) });
    subtables.push({ platform: 3, encoding: 10, data: generateCmapFormat12(unicodeMap) });
    if (ivsRecords.length > 0) subtables.push({ platform: 0, encoding: 5, data: generateCmapFormat14(ivsRecords) });
    subtables.sort((a, b) => (a.platform !== b.platform) ? a.platform - b.platform : a.encoding - b.encoding);
    const headerSize = 4 + subtables.length * 8;
    let totalCmapLen = headerSize;
    for (const t of subtables) totalCmapLen += t.data.length;
    const newCmap = new Uint8Array(totalCmapLen);
    const ncw = new DataView(newCmap.buffer);
    ncw.setUint16(2, subtables.length, false);
    let dataOffset = headerSize;
    for (let i = 0; i < subtables.length; i++) {
        const t = subtables[i]!;
        ncw.setUint16(4 + i * 8, t.platform, false); ncw.setUint16(4 + i * 8 + 2, t.encoding, false);
        ncw.setUint32(4 + i * 8 + 4, dataOffset, false);
        newCmap.set(t.data, dataOffset); dataOffset += t.data.length;
    }
    return injectCustomTables(subsetBuffer, { 'cmap': newCmap });
}

export async function subsetFont(fontPath: string, text: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const fontBuffer = await fs.readFile(fontPath);
    const arrayBuffer = fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength);
    const font = opentype.parse(arrayBuffer);
    const ivsMap = parseCmapFormat14(arrayBuffer);
    const glyphs: opentype.Glyph[] = [];
    const addedGlyphs = new Map<opentype.Glyph, number>();
    const unicodeMap: { code: number, gid: number }[] = [];
    const ivsRecords: { vs: number, code: number, gid: number }[] = [];

    const addGlyphToSubset = (g: opentype.Glyph): number => {
        if (!addedGlyphs.has(g)) { const id = glyphs.length; glyphs.push(g); addedGlyphs.set(g, id); return id; }
        return addedGlyphs.get(g)!;
    };
    addGlyphToSubset(font.glyphs.get(0));

    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
        const char = chars[i]!;
        const code = char.codePointAt(0)!;
        let vsCode = 0;
        if (i + 1 < chars.length) {
            const nextCode = chars[i + 1]!.codePointAt(0)!;
            if (isVariationSelector(nextCode)) { vsCode = nextCode; i++; }
        }
        if (vsCode && ivsMap && ivsMap[vsCode]?.[code] !== undefined) {
            const originalGid = ivsMap[vsCode]![code]!;
            const variantGlyph = font.glyphs.get(originalGid);
            if (variantGlyph) {
                const g = new opentype.Glyph({ name: variantGlyph.name || `u${code.toString(16)}_v${vsCode.toString(16)}`, advanceWidth: variantGlyph.advanceWidth, path: variantGlyph.path });
                ivsRecords.push({ vs: vsCode, code, gid: addGlyphToSubset(g) });
            }
        }
        unicodeMap.push({ code, gid: addGlyphToSubset(font.charToGlyph(char)) });
    }
    const subset = new opentype.Font({ familyName: 'TobariSubset', styleName: 'Regular', unitsPerEm: font.unitsPerEm, ascender: font.ascender, descender: font.descender, glyphs });
    let finalBuffer = injectNativeCmap(subset.toArrayBuffer(), unicodeMap, ivsRecords);
    const woff2Buffer = await wawoff2.compress(new Uint8Array(finalBuffer));
    return { buffer: Buffer.from(woff2Buffer), mimeType: 'font/woff2' };
}

export function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
