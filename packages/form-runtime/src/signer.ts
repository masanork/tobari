export const globalSigner = {
    getPublicKey: () => null,
    register: async () => true,
    getIssuerDid: () => "did:web:example.com",
    sign: async (payload: any) => ({ ...payload, proof: { type: "dummy" } })
};
