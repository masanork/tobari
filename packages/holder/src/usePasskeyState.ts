import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export function usePasskeyState() {
  const [usePasskey, setUsePasskey] = useState<boolean>(false);
  const [passkeyId, setPasskeyId] = useState<string | null>(localStorage.getItem("tobari_passkey_id"));

  const registerPasskey = useCallback(async (setStatus: (s: string) => void, setError: (e: string | null) => void) => {
      setStatus("Registering Passkey via Native API...");
      try {
          // Call the Rust command we fixed earlier
          const responseStr: string = await invoke("perform_register");
          const response = JSON.parse(responseStr);
          
          const id = response.credentialId;
          setPasskeyId(id);
          localStorage.setItem("tobari_passkey_id", id);
          setStatus("Passkey registered successfully!");
      } catch (e: any) {
          console.error(e);
          const errorMessage = typeof e === 'object' ? (e.details || e.message || JSON.stringify(e)) : e;
          setError("Passkey registration failed: " + errorMessage);
      }
  }, []);

  return { usePasskey, setUsePasskey, passkeyId, registerPasskey };
}
