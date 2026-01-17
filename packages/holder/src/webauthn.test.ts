import { expect, test, describe, mock, beforeEach } from "bun:test";
import { registerPasskeyWithPrf, getPrfOutput } from "./webauthn";

describe("WebAuthn PRF Utilities", () => {
    beforeEach(() => {
        // Mock global navigator and crypto
        (global as any).window = {
            crypto: {
                getRandomValues: (arr: Uint8Array) => {
                    for (let i = 0; i < arr.length; i++) arr[i] = i;
                    return arr;
                }
            },
            location: { hostname: "localhost" }
        };

        (global as any).navigator = {
            credentials: {
                create: mock(async () => ({
                    rawId: new Uint8Array([1, 2, 3]).buffer,
                    getClientExtensionResults: () => ({
                        prf: { enabled: true }
                    })
                })),
                get: mock(async () => ({
                    getClientExtensionResults: () => ({
                        prf: {
                            results: {
                                first: new Uint8Array([10, 20, 30]).buffer
                            }
                        }
                    })
                }))
            }
        };
        (global as any).PublicKeyCredential = {};
    });

    test("registerPasskeyWithPrf should return credential rawId", async () => {
        const id = await registerPasskeyWithPrf("test-user");
        expect(id).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(id)).toEqual(new Uint8Array([1, 2, 3]));
        
        const createMock = (navigator.credentials.create as any);
        expect(createMock).toHaveBeenCalled();
        const args = createMock.mock.calls[0][0];
        expect(args.publicKey.extensions.prf).toBeDefined();
    });

    test("getPrfOutput should return PRF bytes", async () => {
        const credId = new Uint8Array([1, 2, 3]);
        const salt = new Uint8Array(32).fill(0xAA);
        
        const output = await getPrfOutput(credId, salt);
        
        expect(output).toBeInstanceOf(Uint8Array);
        expect(Array.from(output)).toEqual([10, 20, 30]);

        const getMock = (navigator.credentials.get as any);
        expect(getMock).toHaveBeenCalled();
        const args = getMock.mock.calls[0][0];
        expect(args.publicKey.extensions.prf.eval.first).toEqual(salt);
    });
});
