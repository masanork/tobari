import { WebAuthnHandler } from "../webauthn-handler.js";
import { SignWithWebAuthnSchema, RegisterWebAuthnSchema } from "../schemas.js";

export async function handleSignWithWebAuthn(toolArgs: any) {
    try {
        const args = SignWithWebAuthnSchema.parse(toolArgs);
        const handler = new WebAuthnHandler();

        const signature = await handler.sign({
            challenge: args.challenge,
            rpId: args.rpId,
            allowCredentials: args.allowCredentials as any
        });

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(signature, null, 2),
                },
            ],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error signing with WebAuthn: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleRegisterWebAuthn(toolArgs: any) {
    try {
        const args = RegisterWebAuthnSchema.parse(toolArgs);
        const handler = new WebAuthnHandler();

        const result = await handler.sign({
            mode: 'register',
            challenge: args.challenge,
            rpId: args.rpId,
            userName: args.userName,
            userDisplayName: args.userDisplayName
        });

        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error registering WebAuthn: ${error.message}` }],
            isError: true,
        };
    }
}

import { McpTool } from "../mcp-tool.js";
export const webauthnTools: McpTool<any>[] = [
    { name: "sign_with_webauthn", description: "Signs a challenge using WebAuthn.", schema: SignWithWebAuthnSchema, handler: handleSignWithWebAuthn },
    { name: "register_webauthn", description: "Registers a new WebAuthn credential.", schema: RegisterWebAuthnSchema, handler: handleRegisterWebAuthn }
];

