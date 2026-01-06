import { WebAuthnHandler } from '../src/webauthn-handler.js';

async function main() {
    console.log('Testing WebAuthn Handler...');
    const handler = new WebAuthnHandler();
    
    // Create a dummy challenge (Base64URL)
    const challenge = "SGVsbG8gd29ybGQ"; // "Hello world"
    const rpId = "localhost";
    
    // Optional: Pass a mode as first arg
    // e.g. bun test/webauthn-test.ts register
    const mode = (process.argv[2] === 'register') ? 'register' : 'sign';
    const allowCredId = (mode === 'sign') ? process.argv[3] : undefined;
    
    let allowCredentials = undefined;
    
    if (allowCredId) {
        console.log(`Restricting to credential ID: ${allowCredId}`);
        allowCredentials = [{
            id: allowCredId,
            type: "public-key" as const
        }];
    }
    
    console.log(`Starting ${mode} flow with challenge: ${challenge}, rpId: ${rpId}`);
    
    try {
        const result = await handler.sign({ 
            mode: mode as any,
            challenge, 
            rpId, 
            allowCredentials
            // userName/userDisplayName omitted to test defaults
        });
        console.log('Action completed successfully:');
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error('Action failed:', e);
    }
}

main();
