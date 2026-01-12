/**
 * Unified Signer Interface - High-level wrapper for signer-macos
 *
 * This module provides convenient functions to call signer-macos
 * using the unified request/response format.
 */

import { spawn } from "child_process";
import {
    UnifiedRequest,
    UnifiedResponse,
    createRequest,
    parseSignerOutput,
    isErrorResponse,
    SupportedCommand
} from "./unified-interface.js";

export interface RunSignerOptions {
    timeout?: number;
    preview?: boolean;
}

/**
 * Run signer-macos with unified interface
 */
export async function runUnifiedSigner(
    signerPath: string,
    command: SupportedCommand,
    params: Record<string, any>,
    options: RunSignerOptions = {}
): Promise<UnifiedResponse> {
    const request = createRequest(command, params, options.preview);
    const requestJSON = JSON.stringify(request);

    console.error(`Running unified signer: ${signerPath} --request '${requestJSON}'`);

    return new Promise<UnifiedResponse>((resolve, reject) => {
        const proc = spawn(signerPath, ["--request", requestJSON]);

        let stdout = "";
        let stderr = "";
        const timeoutMs = options.timeout || 120000; // 2 minutes default

        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error(`Signer timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        proc.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        proc.stderr.on("data", (data) => {
            stderr += data.toString();
            // Echo debug logs from signer
            if (data.toString().startsWith("Debug:")) {
                console.error(data.toString());
            }
        });

        proc.on("close", (code) => {
            clearTimeout(timer);

            if (code === 0) {
                try {
                    const response = parseSignerOutput(stdout, command);
                    resolve(response);
                } catch (error) {
                    reject(new Error(`Failed to parse signer output: ${error instanceof Error ? error.message : String(error)}`));
                }
            } else {
                // Try to parse error from output
                const combined = (stdout + stderr).trim();
                try {
                    const response = JSON.parse(combined) as UnifiedResponse;
                    if (isErrorResponse(response)) {
                        resolve(response); // Return error response instead of rejecting
                    } else {
                        reject(new Error(`Signer exited with code ${code}: ${combined}`));
                    }
                } catch {
                    reject(new Error(`Signer failed (code ${code}): ${combined}`));
                }
            }
        });

        proc.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

/**
 * Run signer with legacy CLI arguments (for backward compatibility)
 */
export async function runLegacySigner(
    signerPath: string,
    args: string[]
): Promise<string> {
    console.error(`Running legacy signer: ${signerPath} ${args.join(" ")}`);

    return new Promise<string>((resolve, reject) => {
        const proc = spawn(signerPath, args);

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        proc.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        proc.on("close", (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                const combined = (stderr + stdout).trim();
                reject(new Error(`Signer failed (code ${code}): ${combined}`));
            }
        });

        proc.on("error", (err) => reject(err));
    });
}

/**
 * Check if signer supports unified interface
 */
export async function supportsUnifiedInterface(signerPath: string): Promise<boolean> {
    try {
        const testRequest = createRequest("get_public_key", {});
        const response = await runUnifiedSigner(signerPath, "get_public_key", {}, { timeout: 5000 });
        return response.status === "success" || isErrorResponse(response);
    } catch {
        return false;
    }
}

// Re-export types for convenience
export * from "./unified-interface.js";
