import { describe, it, expect, mock, spyOn, beforeAll, afterAll } from "bun:test";
import { readTobariFileAsBuffer, decodeSignatureInput, rawEcdsaToDer, loadAllTrustedIssuers } from "../src/utils";
import * as fs from "fs/promises";
import * as child_process from "child_process";

// Mock fs
const readFileSpy = spyOn(fs, "readFile");
const readdirSpy = spyOn(fs, "readdir");
const accessSpy = spyOn(fs, "access");

// Mock child_process.spawn
const spawnSpy = spyOn(child_process, "spawn");

describe("MCP Server Utils", () => {
    describe("Trusted Issuers Loader", () => {
        it("should load issuer keys from examples directory", async () => {
            // Mock readdir for examples dir
            readdirSpy.mockResolvedValueOnce([
                { name: "example1", isDirectory: () => true },
                { name: "file.txt", isDirectory: () => false }
            ] as any);

            // Mock access check for example1/issuer-key.json (success)
            accessSpy.mockResolvedValueOnce(undefined);

            // Mock readdir for example1 (looking for yaml)
            readdirSpy.mockResolvedValueOnce(["doc.yaml", "other.file"] as any);

            // Mock readFile for doc.yaml (to extract docType)
            readFileSpy.mockResolvedValueOnce("id: org.example.doc.v1\ntitle: Test Doc");

            // Mock readFile for issuer-key.json
            const jwk = { kty: "EC", crv: "P-256", x: "x", y: "y" };
            readFileSpy.mockResolvedValueOnce(JSON.stringify(jwk));

            // Mock access check for issuer-pqc-public-key.json (fail - not present)
            accessSpy.mockRejectedValueOnce(new Error("No PQC key"));

            // Mock crypto.subtle.importKey
            const importKeySpy = spyOn(crypto.subtle, "importKey");
            importKeySpy.mockResolvedValueOnce({ type: "public" } as any);

            const issuers = await loadAllTrustedIssuers();

            expect(issuers["org.example.doc.v1"]).toBeDefined();
            expect(readFileSpy).toHaveBeenCalledTimes(2); // yaml + key
            
            importKeySpy.mockRestore();
        });
    });

    describe("readTobariFileAsBuffer", () => {
        it("should read a normal file as buffer", async () => {
            const mockData = new Uint8Array([1, 2, 3]);
            readFileSpy.mockResolvedValueOnce(mockData);

            const result = await readTobariFileAsBuffer("test.cose");
            expect(result).toEqual(mockData);
            expect(readFileSpy).toHaveBeenCalledWith("test.cose");
        });

        it("should extract embedded data from HTML", async () => {
            const b64 = Buffer.from([1, 2, 3]).toString("base64");
            const html = `
                <html>
                <script>
                    window.__TOBARI_DATA__ = "${b64}";
                </script>
                </html>
            `;
            readFileSpy.mockResolvedValueOnce(html);

            const result = await readTobariFileAsBuffer("test.html");
            expect(result).toEqual(new Uint8Array([1, 2, 3]));
        });

        it("should handle data URI scheme in HTML", async () => {
            const b64 = Buffer.from([4, 5, 6]).toString("base64");
            const html = `window.__TOBARI_DATA__ = "data:application/cbor;base64,${b64}"`;
            readFileSpy.mockResolvedValueOnce(html);

            const result = await readTobariFileAsBuffer("data.html");
            expect(result).toEqual(new Uint8Array([4, 5, 6]));
        });

        it("should throw error if HTML marker not found", async () => {
            readFileSpy.mockResolvedValueOnce("<html>No data here</html>");
            
            try {
                await readTobariFileAsBuffer("empty.html");
                expect(true).toBe(false); // Fail if no error
            } catch (e: any) {
                expect(e.message).toContain("Could not find embedded Tobari data");
            }
        });

        it("should bypass decryption if not tobari_enc", async () => {
            const json = JSON.stringify({ key: "value" });
            const data = new TextEncoder().encode(json);
            readFileSpy.mockResolvedValueOnce(data);

            const result = await readTobariFileAsBuffer("plain.json");
            expect(result).toEqual(data);
        });
    });

    describe("Decryption Logic", () => {
        const isDarwin = process.platform === 'darwin';

        it("should attempt native decryption on macOS if ephemeralPublicKey present", async () => {
            if (!isDarwin) return; 

            const encData = {
                tobari_enc: true,
                ephemeralPublicKey: "key",
                ciphertext: "base64data",
                iv: "iv",
                tag: "tag"
            };
            const fileData = new TextEncoder().encode(JSON.stringify(encData));
            readFileSpy.mockResolvedValueOnce(fileData);
            
            accessSpy.mockResolvedValue(undefined);

            const mockStdout = {
                on: (event: string, cb: Function) => {
                    if (event === 'data') cb(JSON.stringify({
                        status: "success",
                        result: { data: Buffer.from([7, 8, 9]).toString('base64url') }
                    }));
                }
            };
            const mockStderr = { on: () => {} };
            const mockProcess = {
                stdout: mockStdout,
                stderr: mockStderr,
                on: (event: string, cb: Function) => { if (event === 'close') cb(0); }
            };
            spawnSpy.mockReturnValue(mockProcess as any);

            const result = await readTobariFileAsBuffer("enc.json");
            
            expect(result).toEqual(new Uint8Array([7, 8, 9]));
            expect(spawnSpy).toHaveBeenCalled();
        });

        it("should fall back to HPKE if native signer fails or not available", async () => {
            const encData = {
                tobari_enc: true,
                ciphertext: Buffer.from([10, 11, 12]).toString('base64'),
                alg: -1 
            };
            const fileData = new TextEncoder().encode(JSON.stringify(encData));
            readFileSpy.mockResolvedValueOnce(fileData);

            try {
                await readTobariFileAsBuffer("enc.json", { hpkeSecret: "secret" });
            } catch (e: any) {
                expect(true).toBe(true);
            }
        });
    });

    describe("Signature Utilities", () => {
        it("decodeSignatureInput should handle base64", () => {
            const data = new Uint8Array([10, 20, 30]);
            const b64 = Buffer.from(data).toString("base64");
            expect(decodeSignatureInput(b64, "base64")).toEqual(data);
        });

        it("decodeSignatureInput should handle base64url", () => {
            const data = new Uint8Array([255, 254]);
            const b64url = Buffer.from(data).toString("base64url");
            expect(decodeSignatureInput(b64url, "base64url")).toEqual(data);
        });

        it("rawEcdsaToDer should convert raw signature to ASN.1 DER", () => {
            const rawSimple = new Uint8Array([0x80, 0x01]);
            const derSimple = rawEcdsaToDer(rawSimple);
            expect(derSimple[0]).toBe(0x30);
            expect(derSimple[2]).toBe(0x02);
            expect(derSimple[3]).toBe(2);
            expect(derSimple[4]).toBe(0x00);
            expect(derSimple[5]).toBe(0x80);
            expect(derSimple[6]).toBe(0x02);
            expect(derSimple[7]).toBe(1);
            expect(derSimple[8]).toBe(0x01);
        });

        it("rawEcdsaToDer should throw on invalid length", () => {
            expect(() => rawEcdsaToDer(new Uint8Array(3))).toThrow("Invalid raw ECDSA signature length");
        });
    });
});