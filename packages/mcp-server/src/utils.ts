import * as path from "path";
import * as fs from "fs/promises";

export const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
export const DEFAULT_MYNA_PATH = path.join(PROJECT_ROOT, "packages/civ/target/debug/dummy-myna");

/**
 * Helper to read a Tobari file (HTML or COSE) and return its binary buffer.
 */
export async function readTobariFileAsBuffer(filePath: string): Promise<Uint8Array> {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html") {
        const htmlContent = await fs.readFile(filePath, "utf-8");

        // Faster lookup than regex matchAll for large files
        const marker = "window.__TOBARI_DATA__ = \"";
        const startIdx = htmlContent.indexOf(marker);
        if (startIdx === -1) {
            throw new Error("Could not find embedded Tobari data in HTML file.");
        }

        const dataStart = startIdx + marker.length;
        const endIdx = htmlContent.indexOf("\"", dataStart);
        if (endIdx === -1) {
            throw new Error("Could not find end of Tobari data in HTML file.");
        }

        let b64 = htmlContent.substring(dataStart, endIdx).replace(/\s/g, '');
        if (b64.startsWith("data:")) {
            const commaIdx = b64.indexOf(",");
            if (commaIdx !== -1) {
                b64 = b64.substring(commaIdx + 1);
            }
        }

        // Use native Buffer for fast base64 decoding
        return new Uint8Array(Buffer.from(b64, 'base64'));
    } else {
        return await fs.readFile(filePath);
    }
}

export function decodeSignatureInput(signature: string, encoding: "base64" | "base64url"): Uint8Array {
    return new Uint8Array(Buffer.from(signature, encoding));
}

export function rawEcdsaToDer(rawSignature: Uint8Array): Uint8Array {
    if (rawSignature.length % 2 !== 0) {
        throw new Error("Invalid raw ECDSA signature length");
    }
    const partLen = rawSignature.length / 2;
    const r = rawSignature.slice(0, partLen);
    const s = rawSignature.slice(partLen);

    const toInteger = (bytes: Uint8Array) => {
        let start = 0;
        while (start < bytes.length - 1 && bytes[start] === 0) start++;
        let trimmed = bytes.slice(start);
        if (trimmed[0] & 0x80) {
            const prefixed = new Uint8Array(trimmed.length + 1);
            prefixed[0] = 0x00;
            prefixed.set(trimmed, 1);
            trimmed = prefixed;
        }
        return trimmed;
    };

    const rInt = toInteger(r);
    const sInt = toInteger(s);
    const totalLen = 2 + rInt.length + 2 + sInt.length;
    const der = new Uint8Array(2 + totalLen);
    let offset = 0;
    der[offset++] = 0x30;
    der[offset++] = totalLen;
    der[offset++] = 0x02;
    der[offset++] = rInt.length;
    der.set(rInt, offset);
    offset += rInt.length;
    der[offset++] = 0x02;
    der[offset++] = sInt.length;
    der.set(sInt, offset);
    return der;
}
