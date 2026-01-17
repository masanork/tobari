export async function isPrfSupported(): Promise<boolean> {
    if (typeof window === 'undefined' || !navigator.credentials || !window.PublicKeyCredential) {
        return false;
    }
    // Check if the browser supports PRF extension (rough check)
    // Most modern browsers supporting Passkeys on macOS 14+ support it.
    return true; 
}

export async function registerPasskeyWithPrf(userName: string): Promise<ArrayBuffer> {
    const challenge = window.crypto.getRandomValues(new Uint8Array(32));
    const userId = window.crypto.getRandomValues(new Uint8Array(16));

    const publicKey: PublicKeyCredentialCreationOptions = {
        challenge,
        rp: { name: "Tobari" },
        user: {
            id: userId,
            name: userName,
            displayName: userName
        },
        pubKeyCredParams: [
            { alg: -7, type: "public-key" },   // ES256
            { alg: -257, type: "public-key" } // RS256
        ],
        authenticatorSelection: {
            residentKey: "required",
            userVerification: "required"
        },
        extensions: {
            prf: {
                eval: {
                    first: new Uint8Array(32) // Request PRF capability
                }
            }
        } as any
    };

    const credential = await navigator.credentials.create({ publicKey }) as any;
    if (!credential) throw new Error("Registration failed");

    const extensions = credential.getClientExtensionResults();
    if (!extensions.prf || !extensions.prf.enabled) {
        console.warn("PRF extension not enabled on this authenticator");
    }

    return credential.rawId;
}

export async function getPrfOutput(credentialId: Uint8Array | ArrayBuffer, salt: Uint8Array): Promise<Uint8Array> {
    const challenge = window.crypto.getRandomValues(new Uint8Array(32));

    const publicKey: PublicKeyCredentialRequestOptions = {
        challenge,
        allowCredentials: [{
            type: "public-key",
            id: (credentialId instanceof Uint8Array ? credentialId.buffer : credentialId) as ArrayBuffer
        }],
        userVerification: "required",
        extensions: {
            prf: {
                eval: {
                    first: salt
                }
            }
        } as any
    };

    const assertion = await navigator.credentials.get({ publicKey }) as any;
    if (!assertion) throw new Error("Authentication failed");

    const extensions = assertion.getClientExtensionResults();
    if (extensions.prf && extensions.prf.results && extensions.prf.results.first) {
        return new Uint8Array(extensions.prf.results.first);
    }

    throw new Error("PRF output not found in extension results");
}

export function bufferToHex(buffer: ArrayBuffer): string {
    return [...new Uint8Array(buffer)]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

export function hexToBuffer(hex: string): Uint8Array {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return new Uint8Array(0);
    return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}
