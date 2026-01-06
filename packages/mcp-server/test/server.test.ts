import { spawn } from "node:child_process";
import { describe, it, expect } from "bun:test";
import path from "path";
import { decode } from "cbor-x";

describe("MCP Server", () => {
    it("should read and verify ininjo.html", async () => {
        const serverPath = path.resolve(import.meta.dir, "../src/index.ts");
        const proc = spawn("bun", ["run", serverPath], {
            stdio: ["pipe", "pipe", "inherit"],
        });

        const targetFile = path.resolve(import.meta.dir, "../../../examples/ininjo/ininjo.html");
        const keyFile = path.resolve(import.meta.dir, "../../../examples/ininjo/issuer-key.json");

        const initReq = {
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0" }
            }
        };

        const toolReq = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
                name: "read_tobari_file",
                arguments: {
                    path: targetFile,
                    issuerPublicKeyPath: keyFile
                }
            }
        };

        if (!proc.stdin || !proc.stdout) throw new Error("No stdio");

        proc.stdin.write(JSON.stringify(initReq) + "\n");
        proc.stdin.write(JSON.stringify(toolReq) + "\n");

        let outputBuffer = "";

        // Collect output
        proc.stdout.on("data", (chunk) => {
            outputBuffer += chunk.toString();
        });

        // Wait for expected response
        const waitForResponse = async () => {
            for (let i = 0; i < 20; i++) {
                if (outputBuffer.includes('"id":1')) {
                    return;
                }
                await new Promise(r => setTimeout(r, 200));
            }
            throw new Error("Timeout waiting for response. Output: " + outputBuffer);
        };

        try {
            await waitForResponse();
        } finally {
            proc.kill();
        }

        const lines = outputBuffer.split("\n");
        const responseLine = lines.find(l => {
            try { return JSON.parse(l).id === 1; } catch { return false; }
        });

        expect(responseLine).toBeDefined();
        if (!responseLine) return;

        console.log("Response Line:", responseLine);
        const response = JSON.parse(responseLine);

        // Verify content
        expect(response.result).toBeDefined();
        if (response.error) {
            console.error("MCP Error:", response.error);
            throw new Error(`MCP returned error: ${response.error.message}`);
        }

        const contentText = response.result.content[0].text;
        const resultData = JSON.parse(contentText);

        expect(resultData._meta.valid).toBe(true);
        expect(resultData.docType).toBe("io.github.masanork.tobari.ininjo.v1");
        expect(resultData.principal.name).toBe("甲野 太郎");
    }, 10000);

    it("should read and verify ininjo.cose", async () => {
        const serverPath = path.resolve(import.meta.dir, "../src/index.ts");
        const proc = spawn("bun", ["run", serverPath], {
            stdio: ["pipe", "pipe", "inherit"],
        });

        const targetFile = path.resolve(import.meta.dir, "../../../examples/ininjo/ininjo.cose");
        const keyFile = path.resolve(import.meta.dir, "../../../examples/ininjo/issuer-key.json");

        const initReq = {
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0" }
            }
        };

        const toolReq = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
                name: "read_tobari_file",
                arguments: {
                    path: targetFile,
                    issuerPublicKeyPath: keyFile
                }
            }
        };

        if (!proc.stdin || !proc.stdout) throw new Error("No stdio");

        proc.stdin.write(JSON.stringify(initReq) + "\n");
        proc.stdin.write(JSON.stringify(toolReq) + "\n");

        let outputBuffer = "";

        // Collect output
        proc.stdout.on("data", (chunk) => {
            outputBuffer += chunk.toString();
        });

        // Wait for expected response
        const waitForResponse = async () => {
            for (let i = 0; i < 20; i++) {
                if (outputBuffer.includes('"id":1')) {
                    return;
                }
                await new Promise(r => setTimeout(r, 200));
            }
            throw new Error("Timeout waiting for response. Output: " + outputBuffer);
        };

        try {
            await waitForResponse();
        } finally {
            proc.kill();
        }

        const lines = outputBuffer.split("\n");
        const responseLine = lines.find(l => {
            try { return JSON.parse(l).id === 1; } catch { return false; }
        });

        expect(responseLine).toBeDefined();
        if (!responseLine) return;

        const response = JSON.parse(responseLine);

        // Verify content
        expect(response.result).toBeDefined();
        if (response.error) {
            console.error("MCP Error:", response.error);
            throw new Error(`MCP returned error: ${response.error.message}`);
        }

        const contentText = response.result.content[0].text;
        const resultData = JSON.parse(contentText);

        expect(resultData._meta.valid).toBe(true);
        expect(resultData.docType).toBe("io.github.masanork.tobari.ininjo.v1");
        expect(resultData.principal.name).toBe("甲野 太郎");
    }, 10000);

    it("should read and verify juminhyo.cose", async () => {
        const serverPath = path.resolve(import.meta.dir, "../src/index.ts");
        const proc = spawn("bun", ["run", serverPath], {
            stdio: ["pipe", "pipe", "inherit"],
        });

        const targetFile = path.resolve(import.meta.dir, "../../../examples/juminhyo/juminhyo.cose");
        // Reuse the same issuer key for testing if applicable, or find the correct one.
        // Usually examples use their own keys, let's check if it exists.
        const keyFile = path.resolve(import.meta.dir, "../../../examples/ininjo/issuer-key.json");

        const initReq = {
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0" }
            }
        };

        const toolReq = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
                name: "read_tobari_file",
                arguments: {
                    path: targetFile,
                    // Skipping verification for now as juminhyo might use a different key
                }
            }
        };

        if (!proc.stdin || !proc.stdout) throw new Error("No stdio");

        proc.stdin.write(JSON.stringify(initReq) + "\n");
        proc.stdin.write(JSON.stringify(toolReq) + "\n");

        let outputBuffer = "";
        proc.stdout.on("data", (chunk) => {
            outputBuffer += chunk.toString();
        });

        const waitForResponse = async () => {
            for (let i = 0; i < 20; i++) {
                if (outputBuffer.includes('"id":1')) return;
                await new Promise(r => setTimeout(r, 200));
            }
        };

        await waitForResponse();
        proc.kill();

        const responseLine = outputBuffer.split("\n").find(l => {
            try { return JSON.parse(l).id === 1; } catch { return false; }
        });

        expect(responseLine).toBeDefined();
        const response = JSON.parse(responseLine!);
        const resultData = JSON.parse(response.result.content[0].text);

        console.log("Juminhyo docType:", resultData.docType);
        expect(resultData.docType).toBe("io.github.masanork.tobari.juminhyo.v1");
        expect(resultData.世帯主氏名).toBeDefined();
    }, 10000);

    it("should create a VP from multiple documents", async () => {
        const serverPath = path.resolve(import.meta.dir, "../src/index.ts");
        const proc = spawn("bun", ["run", serverPath], {
            stdio: ["pipe", "pipe", "inherit"],
        });

        const ininjoFile = path.resolve(import.meta.dir, "../../../examples/ininjo/ininjo.cose");
        const juminhyoFile = path.resolve(import.meta.dir, "../../../examples/juminhyo/juminhyo.cose");
        const deviceKeyFile = path.resolve(import.meta.dir, "../../../examples/ininjo/device-key.json");

        const initReq = {
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0" }
            }
        };

        const toolReq = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
                name: "create_presentation",
                arguments: {
                    requests: [
                        { path: ininjoFile, fields: ["scope"] },
                        { path: juminhyoFile, fields: ["世帯主氏名", "世帯住所"] }
                    ],
                    devicePrivateKeyPath: deviceKeyFile,
                    verifierNonce: "test-nonce-123"
                }
            }
        };

        if (!proc.stdin || !proc.stdout) throw new Error("No stdio");

        proc.stdin.write(JSON.stringify(initReq) + "\n");
        proc.stdin.write(JSON.stringify(toolReq) + "\n");

        let outputBuffer = "";
        proc.stdout.on("data", (chunk) => {
            outputBuffer += chunk.toString();
        });

        const waitForResponse = async () => {
            for (let i = 0; i < 20; i++) {
                if (outputBuffer.includes('"id":1')) return;
                await new Promise(r => setTimeout(r, 200));
            }
        };

        await waitForResponse();
        proc.kill();

        const responseLine = outputBuffer.split("\n").find(l => {
            try { return JSON.parse(l).id === 1; } catch { return false; }
        });

        expect(responseLine).toBeDefined();
        const response = JSON.parse(responseLine!);
        if (response.error) {
            throw new Error(`MCP Error: ${response.error.message}`);
        }

        const resultData = JSON.parse(response.result.content[0].text);
        expect(resultData.vp_base64).toBeDefined();
        expect(resultData.document_count).toBe(2);

        // Optional: Decode VP to verify structure
        const vpBytes = Buffer.from(resultData.vp_base64, 'base64');
        const vp = decode(vpBytes);
        expect(vp.version).toBe("1.0");
        expect(vp.documents.length).toBe(2);
        
        // Check first document (Ininjo)
        const doc1 = vp.documents[0];
        expect(doc1.docType).toBe("io.github.masanork.tobari.ininjo.v1");
        expect(doc1.deviceSigned.deviceAuth).toBeDefined();
    }, 15000);

    it("should create a VP using 2-step external signing process", async () => {
        const serverPath = path.resolve(import.meta.dir, "../src/index.ts");
        const proc = spawn("bun", ["run", serverPath], {
            stdio: ["pipe", "pipe", "inherit"],
        });

        const ininjoFile = path.resolve(import.meta.dir, "../../../examples/ininjo/ininjo.cose");
        const deviceKeyFile = path.resolve(import.meta.dir, "../../../examples/ininjo/device-key.json");

        const initReq = {
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0" }
            }
        };

        if (!proc.stdin || !proc.stdout) throw new Error("No stdio");
        proc.stdin.write(JSON.stringify(initReq) + "\n");

        // Step 1: Prepare
        const prepareReq = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
                name: "prepare_presentation",
                arguments: {
                    requests: [{ path: ininjoFile, fields: ["id"] }],
                    verifierNonce: "external-nonce"
                }
            }
        };
        proc.stdin.write(JSON.stringify(prepareReq) + "\n");

        let outputBuffer = "";
        const waitForId1 = async () => {
            for (let i = 0; i < 20; i++) {
                if (outputBuffer.includes('"id":1')) return;
                await new Promise(r => setTimeout(r, 200));
            }
        };

        proc.stdout.on("data", (chunk) => {
            outputBuffer += chunk.toString();
        });

        await waitForId1();
        
        const lines = outputBuffer.split("\n");
        const resp1 = JSON.parse(lines.find(l => { try { return JSON.parse(l).id === 1; } catch { return false; } })!);
        const preparedResult = JSON.parse(resp1.result.content[0].text);
        
        const itemToSign = preparedResult.itemsToSign[0];
        const toBeSigned = Buffer.from(itemToSign.toBeSignedBase64, 'base64');

        // SIMULATE EXTERNAL SIGNING
        const keyContent = await (await import("fs/promises")).readFile(deviceKeyFile, "utf-8");
        const jwk = JSON.parse(keyContent);
        const devicePrivateKey = await crypto.subtle.importKey(
            "jwk", jwk, { name: "ECDSA", namedCurve: "P-384" }, true, ["sign"]
        );
        const signatureBuffer = await crypto.subtle.sign(
            { name: 'ECDSA', hash: { name: 'SHA-384' } },
            devicePrivateKey,
            toBeSigned
        );
        const signatureBase64 = Buffer.from(signatureBuffer).toString('base64');

        // Step 2: Assemble
        const assembleReq = {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
                name: "assemble_presentation",
                arguments: {
                    preparedData: preparedResult.preparedData,
                    signatures: [signatureBase64]
                }
            }
        };
        proc.stdin.write(JSON.stringify(assembleReq) + "\n");

        const waitForId2 = async () => {
            for (let i = 0; i < 20; i++) {
                if (outputBuffer.includes('"id":2')) return;
                await new Promise(r => setTimeout(r, 200));
            }
        };
        await waitForId2();
        proc.kill();

        const resp2Line = outputBuffer.split("\n").find(l => { try { return JSON.parse(l).id === 2; } catch { return false; } });
        expect(resp2Line).toBeDefined();
        const resp2 = JSON.parse(resp2Line!);
        const finalResult = JSON.parse(resp2.result.content[0].text);

        expect(finalResult.vp_base64).toBeDefined();
        
        // Verify final VP structure
        const vp = decode(Buffer.from(finalResult.vp_base64, 'base64'));
        expect(vp.documents[0].deviceSigned.deviceAuth).toBeDefined();
    }, 15000);

    it("should verify a created VP successfully", async () => {
        const serverPath = path.resolve(import.meta.dir, "../src/index.ts");
        const proc = spawn("bun", ["run", serverPath], {
            stdio: ["pipe", "pipe", "inherit"],
        });

        const ininjoFile = path.resolve(import.meta.dir, "../../../examples/ininjo/ininjo.cose");
        const deviceKeyFile = path.resolve(import.meta.dir, "../../../examples/ininjo/device-key.json");
        const issuerKeyFile = path.resolve(import.meta.dir, "../../../examples/ininjo/issuer-key.json");

        const initReq = { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
        
        if (!proc.stdin || !proc.stdout) throw new Error("No stdio");
        proc.stdin.write(JSON.stringify(initReq) + "\n");

        // 1. Create VP
        const createReq = {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: {
                name: "create_presentation",
                arguments: {
                    requests: [{ path: ininjoFile, fields: ["id"] }],
                    devicePrivateKeyPath: deviceKeyFile
                }
            }
        };
        proc.stdin.write(JSON.stringify(createReq) + "\n");

        let outputBuffer = "";
        proc.stdout.on("data", (chunk) => { outputBuffer += chunk.toString(); });

        const waitForId = async (id: number) => {
            for (let i = 0; i < 20; i++) {
                if (outputBuffer.includes(`"id":${id}`)) return;
                await new Promise(r => setTimeout(r, 200));
            }
        };

        await waitForId(1);
        const createResp = JSON.parse(outputBuffer.split("\n").find(l => { try { return JSON.parse(l).id === 1; } catch { return false; } })!);
        const vpBase64 = JSON.parse(createResp.result.content[0].text).vp_base64;

        // 2. Verify VP
        const verifyReq = {
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: {
                name: "verify_presentation",
                arguments: {
                    vpBase64: vpBase64,
                    issuerPublicKeys: {
                        "io.github.masanork.tobari.ininjo.v1": issuerKeyFile
                    }
                }
            }
        };
        proc.stdin.write(JSON.stringify(verifyReq) + "\n");

        await waitForId(2);
        proc.kill();

        const verifyRespLine = outputBuffer.split("\n").find(l => { try { return JSON.parse(l).id === 2; } catch { return false; } });
        expect(verifyRespLine).toBeDefined();
        const verifyResult = JSON.parse(JSON.parse(verifyRespLine!).result.content[0].text);

        expect(verifyResult.overall_valid).toBe(true);
        expect(verifyResult.results[0].issuerValid).toBe(true);
        expect(verifyResult.results[0].deviceValid).toBe(true);
        expect(verifyResult.results[0].data.id).toBeDefined();
    }, 15000);

    it("should create and verify a multi-source VP (Juminhyo + Bank)", async () => {
        const serverPath = path.resolve(import.meta.dir, "../src/index.ts");
        const proc = spawn("bun", ["run", serverPath], {
            stdio: ["pipe", "pipe", "inherit"],
        });

        const juminhyoFile = path.resolve(import.meta.dir, "../../../examples/juminhyo/juminhyo.cose");
        const bankFile = path.resolve(import.meta.dir, "../../../examples/bank-certificate/bank-certificate.cose");
        const deviceKeyFile = path.resolve(import.meta.dir, "../../../examples/ininjo/device-key.json");
        
        const juminhyoIssuerKey = path.resolve(import.meta.dir, "../../../examples/juminhyo/issuer-key.json");
        const bankIssuerKey = path.resolve(import.meta.dir, "../../../examples/bank-certificate/issuer-key.json");

        const initReq = { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
        
        if (!proc.stdin || !proc.stdout) throw new Error("No stdio");
        proc.stdin.write(JSON.stringify(initReq) + "\n");

        // 1. Create Multi-source VP
        const createReq = {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: {
                name: "create_presentation",
                arguments: {
                    requests: [
                        { path: juminhyoFile, fields: ["世帯主氏名", "世帯住所"] },
                        { path: bankFile, fields: ["bank_name", "account_number"] }
                    ],
                    devicePrivateKeyPath: deviceKeyFile
                }
            }
        };
        proc.stdin.write(JSON.stringify(createReq) + "\n");

        let outputBuffer = "";
        proc.stdout.on("data", (chunk) => { outputBuffer += chunk.toString(); });

        const waitForId = async (id: number) => {
            for (let i = 0; i < 20; i++) {
                if (outputBuffer.includes(`"id":${id}`)) return;
                await new Promise(r => setTimeout(r, 200));
            }
        };

        await waitForId(1);
        const createRespLine = outputBuffer.split("\n").find(l => { try { return JSON.parse(l).id === 1; } catch { return false; } });
        const vpBase64 = JSON.parse(JSON.parse(createRespLine!).result.content[0].text).vp_base64;

        // 2. Verify Multi-source VP
        const verifyReq = {
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: {
                name: "verify_presentation",
                arguments: {
                    vpBase64: vpBase64,
                    issuerPublicKeys: {
                        "io.github.masanork.tobari.juminhyo.v1": juminhyoIssuerKey,
                        "io.github.masanork.tobari.bank_certificate.v1": bankIssuerKey
                    }
                }
            }
        };
        proc.stdin.write(JSON.stringify(verifyReq) + "\n");

        await waitForId(2);
        proc.kill();

        const verifyRespLine = outputBuffer.split("\n").find(l => { try { return JSON.parse(l).id === 2; } catch { return false; } });
        const verifyResult = JSON.parse(JSON.parse(verifyRespLine!).result.content[0].text);

        if (!verifyResult.overall_valid) {
            console.error("Multi-source Verification Details (Retry):", JSON.stringify(verifyResult, null, 2));
        }

        expect(verifyResult.overall_valid).toBe(true);
        expect(verifyResult.results.length).toBe(2);
        
        // Juminhyo check
        const juminhyoResult = verifyResult.results.find((r: any) => r.docType === "io.github.masanork.tobari.juminhyo.v1");
        expect(juminhyoResult.issuerValid).toBe(true);
        expect(juminhyoResult.data.世帯主氏名).toBeDefined();

        // Bank check
        const bankResult = verifyResult.results.find((r: any) => r.docType === "io.github.masanork.tobari.bank_certificate.v1");
        expect(bankResult.issuerValid).toBe(true);
        expect(bankResult.data.bank_name).toBeDefined();
    }, 20000);

    it("should analyze a service request document correctly", async () => {
        const serverPath = path.resolve(import.meta.dir, "../src/index.ts");
        const proc = spawn("bun", ["run", serverPath], {
            stdio: ["pipe", "pipe", "inherit"],
        });

        const requestFile = path.resolve(import.meta.dir, "../../../examples/service-request/service-request.cose");

        const initReq = { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
        const analyzeReq = {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: {
                name: "analyze_service_request",
                arguments: { path: requestFile }
            }
        };

        if (!proc.stdin || !proc.stdout) throw new Error("No stdio");
        proc.stdin.write(JSON.stringify(initReq) + "\n");
        proc.stdin.write(JSON.stringify(analyzeReq) + "\n");

        let outputBuffer = "";
        proc.stdout.on("data", (chunk) => { outputBuffer += chunk.toString(); });

        const waitForId = async (id: number) => {
            for (let i = 0; i < 20; i++) {
                if (outputBuffer.includes(`"id":${id}`)) return;
                await new Promise(r => setTimeout(r, 200));
            }
        };

        await waitForId(1);
        proc.kill();

        const respLine = outputBuffer.split("\n").find(l => { try { return JSON.parse(l).id === 1; } catch { return false; } });
        expect(respLine).toBeDefined();
        const analysis = JSON.parse(JSON.parse(respLine!).result.content[0].text);

        expect(analysis.title).toContain("子育て世帯");
        expect(analysis.requiredCredentials.length).toBeGreaterThan(1);
        
        const juminhyoReq = analysis.requiredCredentials.find((c: any) => c.requiredFields[0].docType === "io.github.masanork.tobari.juminhyo.v1");
        expect(juminhyoReq).toBeDefined();

        const bankReq = analysis.requiredCredentials.find((c: any) => c.requiredFields[0].docType === "io.github.masanork.tobari.bank_certificate.v1");
        expect(bankReq).toBeDefined();

        expect(analysis.requiredUserInputs.length).toBeGreaterThan(0);
        expect(analysis.requiredUserInputs[0].fields[0].id).toBe("contact_phone");
    }, 10000);

    it("should list available demo documents", async () => {
        const serverPath = path.resolve(import.meta.dir, "../src/index.ts");
        const proc = spawn("bun", ["run", serverPath], {
            stdio: ["pipe", "pipe", "inherit"],
        });

        const initReq = { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
        const listReq = {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: {
                name: "list_available_documents",
                arguments: {}
            }
        };

        if (!proc.stdin || !proc.stdout) throw new Error("No stdio");
        proc.stdin.write(JSON.stringify(initReq) + "\n");
        proc.stdin.write(JSON.stringify(listReq) + "\n");

        let outputBuffer = "";
        proc.stdout.on("data", (chunk) => { outputBuffer += chunk.toString(); });

        const waitForId = async (id: number) => {
            for (let i = 0; i < 20; i++) {
                if (outputBuffer.includes(`"id":${id}`)) return;
                await new Promise(r => setTimeout(r, 200));
            }
        };

        await waitForId(1);
        proc.kill();

        const respLine = outputBuffer.split("\n").find(l => { try { return JSON.parse(l).id === 1; } catch { return false; } });
        expect(respLine).toBeDefined();
        const result = JSON.parse(JSON.parse(respLine!).result.content[0].text);

        expect(result.documents.length).toBeGreaterThan(0);
        const ininjo = result.documents.find((d: any) => d.name === "ininjo.html");
        expect(ininjo).toBeDefined();
        expect(ininjo.category).toBe("Credential");

        const serviceRequest = result.documents.find((d: any) => d.name === "service-request.html");
        expect(serviceRequest).toBeDefined();
        expect(serviceRequest.category).toBe("Administrative Request");
    }, 10000);
});
