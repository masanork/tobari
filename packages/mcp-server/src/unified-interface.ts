/**
 * Unified Interface for Tobari Signer
 *
 * This module defines the unified request/response format for communication
 * between MCP Server and signer-macos. Designed to support future AP2 integration.
 */

// MARK: - Unified Request/Response Protocol

export interface UnifiedRequest {
    command: string;
    params: Record<string, any>;
    preview?: boolean;
}

export type ResponseStatus = "success" | "error" | "preview";

export interface UnifiedResponse {
    status: ResponseStatus;
    command: string;
    result?: ResponseResult;
    preview?: PreviewInfo;
    error?: ErrorInfo;
}

// MARK: - Result Types

export type ResultType = "vp" | "signature" | "cardData" | "key" | "application" | "encrypted";
export type DataFormat = "cose" | "json" | "cbor" | "jwt" | "der" | "base64";

export interface ResponseResult {
    type: ResultType;
    format: DataFormat;
    data: string | Record<string, any>;  // Base64URL string or JSON object
    metadata?: Record<string, any>;
}

export interface PreviewInfo {
    summary: string;
    fields?: PreviewField[];
    requiresApproval: boolean;
    sessionId?: string;
}

export interface PreviewField {
    name: string;
    value: string;
    disclosed: boolean;
}

export type ErrorType =
    | "IncorrectPin"
    | "PinLocked"
    | "CardNotFound"
    | "UserCancelled"
    | "InvalidRequest"
    | "InternalError"
    | "UnsupportedCommand";

export interface ErrorInfo {
    type: ErrorType;
    message: string;
    details?: Record<string, any>;
}

// MARK: - Command-Specific Parameters

export interface SignPresentationParams {
    documentPath?: string;           // Path to mdoc file
    documentData?: string;           // Base64URL encoded document
    disclosureFields?: string[];     // Fields to disclose (e.g., ["name", "birthDate"])
    verifierId?: string;             // OID4VP Client ID
    nonce?: string;                  // OID4VP session nonce
    responseUri?: string;            // OID4VP response URI
    sessionTranscript?: string;      // Base64URL encoded session transcript
    outputFormat?: "cose" | "jwt";   // Output format
    outputPath?: string;             // Path to save VP
}

export type CardType = "jpki" | "passport" | "drivers_license" | "residence_card";

export interface ReadCardParams {
    cardType: CardType;
    pin?: string;
    pin1?: string;
    pin2?: string;
    mrz?: string;                    // For passport
    can?: string;                    // For passport PACE
    usePace?: boolean;
}

export interface CreateApplicationParams {
    documentPath: string;            // Path to mdoc to apply for
    devicePublicKey?: string;        // Optional: use existing device key
    jpkiPin?: string;               // PIN for JPKI signature
    outputPath?: string;            // Where to save application
}

export interface RegisterDeviceParams {
    keyType?: "passkey" | "secure_enclave";
    exportPublicKey?: boolean;       // Export public key in JWK format
}

export interface SignDataParams {
    data: string;                    // Base64URL encoded data to sign
    algorithm?: string;              // "ES256", "ES384", "RS256", etc.
    keyId?: string;                 // Optional key identifier
}

export interface DecryptDataParams {
    encryptedData: string;           // Base64URL encoded HPKE encrypted data
    metadata?: Record<string, string>;
}

// MARK: - Helper Functions

export function createSuccessResponse(
    command: string,
    type: ResultType,
    format: DataFormat,
    data: string | Record<string, any>,
    metadata?: Record<string, any>
): UnifiedResponse {
    return {
        status: "success",
        command,
        result: {
            type,
            format,
            data,
            metadata
        }
    };
}

export function createErrorResponse(
    command: string,
    type: ErrorType,
    message: string,
    details?: Record<string, any>
): UnifiedResponse {
    return {
        status: "error",
        command,
        error: {
            type,
            message,
            details
        }
    };
}

export function createPreviewResponse(
    command: string,
    summary: string,
    fields: PreviewField[],
    sessionId: string
): UnifiedResponse {
    return {
        status: "preview",
        command,
        preview: {
            summary,
            fields,
            requiresApproval: true,
            sessionId
        }
    };
}

// MARK: - Backward Compatibility Types

export interface LegacySignRequest {
    challenge: string;
    rp_id: string;
    message?: string;
    user_verification?: string;
}

export interface LegacySignResponse {
    signature: string;
    authData?: string;
    clientDataJSON?: string;
    publicKey?: string;
}

// MARK: - Command Registry

export const SUPPORTED_COMMANDS = [
    "sign_presentation",
    "read_card",
    "create_application",
    "register_device",
    "sign_data",
    "decrypt_data",
    "get_public_key",
    "approve_preview"
] as const;

export type SupportedCommand = typeof SUPPORTED_COMMANDS[number];

// MARK: - Conversion Utilities

/**
 * Convert legacy format to unified format
 */
export function legacyToUnified(legacyRequest: LegacySignRequest, command: string = "sign_data"): UnifiedRequest {
    return {
        command,
        params: {
            data: legacyRequest.challenge,
            algorithm: "ES256",
            rpId: legacyRequest.rp_id,
            message: legacyRequest.message,
            userVerification: legacyRequest.user_verification
        }
    };
}

/**
 * Convert unified response to legacy format (for backward compatibility)
 */
export function unifiedToLegacy(response: UnifiedResponse): LegacySignResponse | null {
    if (response.status !== "success" || !response.result) {
        return null;
    }

    const data = response.result.data;
    if (typeof data === "string") {
        return {
            signature: data,
            publicKey: response.result.metadata?.publicKey as string
        };
    } else if (typeof data === "object") {
        return {
            signature: data.signature as string,
            authData: data.authData as string,
            clientDataJSON: data.clientDataJSON as string,
            publicKey: data.publicKey as string
        };
    }

    return null;
}

/**
 * Parse signer-macos JSON output into UnifiedResponse
 */
export function parseSignerOutput(stdout: string, command: string): UnifiedResponse {
    try {
        const parsed = JSON.parse(stdout);

        // Check if it's already in unified format
        if (parsed.status && parsed.command) {
            return parsed as UnifiedResponse;
        }

        // Legacy format - convert to unified
        if (parsed.signature) {
            return createSuccessResponse(
                command,
                "signature",
                "base64",
                parsed
            );
        }

        // Card data format
        return createSuccessResponse(
            command,
            "cardData",
            "json",
            parsed
        );
    } catch (error) {
        return createErrorResponse(
            command,
            "InternalError",
            `Failed to parse signer output: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Create UnifiedRequest for running signer-macos
 */
export function createRequest(
    command: SupportedCommand,
    params: Record<string, any>,
    preview?: boolean
): UnifiedRequest {
    return {
        command,
        params,
        preview
    };
}

// MARK: - Type Guards

export function isUnifiedResponse(obj: any): obj is UnifiedResponse {
    return (
        obj &&
        typeof obj === "object" &&
        typeof obj.status === "string" &&
        typeof obj.command === "string" &&
        ["success", "error", "preview"].includes(obj.status)
    );
}

export function isErrorResponse(response: UnifiedResponse): response is UnifiedResponse & { error: ErrorInfo } {
    return response.status === "error" && response.error !== undefined;
}

export function isPreviewResponse(response: UnifiedResponse): response is UnifiedResponse & { preview: PreviewInfo } {
    return response.status === "preview" && response.preview !== undefined;
}

export function isSuccessResponse(response: UnifiedResponse): response is UnifiedResponse & { result: ResponseResult } {
    return response.status === "success" && response.result !== undefined;
}
