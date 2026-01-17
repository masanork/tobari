import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface SignRequest {
  challenge: string;
  rp_id: string;
  user_verification?: string;
  message?: string;
  allow_credentials?: { id: string; type_: string }[];
  disclosureItems?: { label: string; value: string }[];
  bbs?: {
    publicKey: string;
    signature: string;
    messages: string[];
    revealedIndices: number[];
  };
}

export function usePendingRequest(setStatus: (s: string) => void, setError: (e: string | null) => void, formatError: (e: any) => string) {
  const [request, setRequest] = useState<SignRequest | null>(null);

  const fetchRequest = useCallback(async () => {
    try {
      const rawReq = await invoke<any>("get_pending_request");
      if (rawReq) {
        // Map from Unified Response preview if present
        let mappedReq: SignRequest = rawReq;
        if (rawReq.preview && rawReq.status === "preview") {
           mappedReq = {
             challenge: rawReq.preview.sessionId || "demo-nonce",
             rp_id: rawReq.command === "sign_presentation" ? "Identity Verifier" : "Tobari",
             message: rawReq.preview.summary,
             disclosureItems: rawReq.preview.fields?.map((f: any) => ({
               label: f.name,
               value: f.value
             }))
           };
        }
        setRequest(mappedReq);
        setStatus("Waiting for user approval");
      } else {
        setStatus("No pending request found.");
      }
    } catch (e) {
      setError("Failed to load request: " + formatError(e));
    }
  }, [setStatus, setError, formatError]);

  useEffect(() => {
    fetchRequest();
  }, [fetchRequest]);

  const handleSign = async () => {
    setStatus("Interacting with authenticator... Please touch your device.");
    setError(null);
    try {
      await invoke("perform_sign");
      setStatus("Signed successfully! Closing...");
    } catch (e: any) {
      setError("Signing failed: " + formatError(e));
      setStatus("Error");
    }
  };

  const handleJpkiSign = async (pin: string) => {
    if (!pin || !request) return;
    setStatus("Accessing My Number Card... Please do not remove the card.");
    setError(null);
    try {
      await invoke("jpki_sign", { 
        request: {
          challenge: request.challenge,
          pin: pin
        }
      });
      setStatus("JPKI Signed successfully! Closing...");
    } catch (e: any) {
      setError("JPKI Signing failed: " + formatError(e));
      setStatus("Error");
    }
  };

  const handleBbsProof = async () => {
    if (!request || !request.bbs) return;
    setStatus("Generating zero-knowledge proof...");
    setError(null);
    try {
      await invoke("perform_bbs_proof", {
        publicKeyJson: request.bbs.publicKey,
        signatureJson: request.bbs.signature,
        messages: request.bbs.messages,
        revealedIndices: request.bbs.revealedIndices,
        nonce: request.challenge
      });
      setStatus("Proof generated successfully! Closing...");
    } catch (e: any) {
      setError("BBS Proof generation failed: " + formatError(e));
      setStatus("Error");
    }
  };

  const handleReject = async () => {
    await invoke("reject");
  };

  const handleRegister = async () => {
    setStatus("Registering hardware-bound key... Please touch your device.");
    setError(null);
    try {
      const responseStr = await invoke<string>("perform_register");
      const response = JSON.parse(responseStr);
      setStatus(`Key registered! ID: ${response.credentialId.substring(0, 10)}... You can now sign.`);
    } catch (e: any) {
      setError("Registration failed: " + formatError(e));
      setStatus("Error");
    }
  };

  return { request, handleSign, handleJpkiSign, handleBbsProof, handleReject, handleRegister };
}
