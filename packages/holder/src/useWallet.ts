import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { encryptTobariEcies, encodeCanonical as encode, decode } from "@tobari/crypto";
import { create_envelope, add_prf_recipient, decrypt_envelope_with_prf } from "@tobari/civ";
import { getPrfOutput, hexToBuffer } from "./webauthn";

export interface WalletCredential {
  name: string;
  path: string;
  doc_type: string;
  created_at?: number;
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletCredential[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadWallet = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await invoke<WalletCredential[]>("get_wallet_credentials");
      setWallet(items);
    } catch (e) {
      console.error("Failed to load wallet", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const inspectItem = async (cred: WalletCredential) => {
    try {
      const details = await invoke<any>("inspect_wallet_file", { path: cred.path });
      let displayData = details;
      let decryptStatus = "";
      
      if (details && details.tobari_enc === true) {
          if (details.version === "2.0") {
              const prfRecipient = details.recipients?.find((r: any) => r.type === "webauthn-prf");
              if (prfRecipient) {
                  try {
                      const salt = hexToBuffer(prfRecipient.salt);
                      const prfOutput = await getPrfOutput(hexToBuffer(prfRecipient.kid), salt);
                      const decryptedBytes = await decrypt_envelope_with_prf(JSON.stringify(details), prfRecipient.kid, prfOutput);
                      displayData = decode(decryptedBytes);
                      decryptStatus = "Decrypted with Passkey";
                  } catch (de: any) {
                      console.error("Passkey Decryption failed", de);
                      throw new Error(`Passkey Decryption failed: ${de.toString()}`);
                  }
              } else {
                  displayData = await invoke("decrypt_data", { data: details });
                  decryptStatus = "Decrypted with native key";
              }
          } else {
              displayData = await invoke("decrypt_data", { data: details });
              decryptStatus = "Decrypted with legacy device key";
          }
      }
      
      return {
        ...cred,
        _is_wallet_item: true,
        raw_structure: details,
        decrypted_data: displayData,
        decrypt_status: decryptStatus
      };
    } catch (e: any) {
       console.error(e);
       return {
          ...cred,
          _is_wallet_item: true,
          error: e.toString()
       };
    }
  };

  const calculateIdentityHash = async (data: any, type: string): Promise<string> => {
      let source = "";
      if (type === 'jpki') {
          source = `${data.name}|${data.address}|${data.birth_date}|${data.gender}`;
      } else if (type === 'license') {
          source = `${data.license_number}|${data.issue_date}`;
      } else if (type === 'passport') {
          source = `${data.passport_number}|${data.birth_date}|${data.expiry_date}`;
      } else {
          source = JSON.stringify(data);
      }
      
      const encoder = new TextEncoder();
      const buffer = encoder.encode(source);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return hashHex.substring(0, 16);
  };

  const prepareDataForStorage = (data: any) => {
      const result = { ...data };
      const binaryFields = [
          'face_photo', 'auth_cert', 'sign_cert', 'auth_ca_cert', 'sign_ca_cert',
          'dg1', 'dg2', 'sod', 'dg11', 'dg12', 'dg14', 'dg15',
          'signature', 'raw_data_group1'
      ];
      for (const field of binaryFields) {
          if (result[field] && typeof result[field] === 'string') {
              try {
                  const base64 = result[field].replace(/-/g, '+').replace(/_/g, '/');
                  const binString = atob(base64);
                  result[field] = Uint8Array.from(binString, c => c.charCodeAt(0));
              } catch (e) {
                  console.warn(`Failed to convert field ${field} to binary`, e);
              }
          }
      }
      return result;
  };

  const saveToWallet = async (cardData: any, cardType: string, usePasskey: boolean, passkeyId: string | null) => {
      const idHash = await calculateIdentityHash(cardData, cardType);
      let name = `${cardType.toUpperCase()}_${idHash}`;
      let docType = `io.github.masanork.tobari.${cardType}.v1`;

      if (cardType === 'passport') docType = "org.icao.dtc.v1";

      const wrappedData = {
          version: "1.0",
          docType,
          data: prepareDataForStorage(cardData)
      };

      let finalDataToSave: any = null;

      if (usePasskey && passkeyId) {
          const salt = window.crypto.getRandomValues(new Uint8Array(32));
          const prfOutput = await getPrfOutput(hexToBuffer(passkeyId), salt);
          const payload = encode(wrappedData);
          const { envelope: initialEnvelopeJson, dek } = await create_envelope(payload);
          const finalEnvelopeJson = await add_prf_recipient(initialEnvelopeJson, dek, passkeyId, salt, prfOutput);
          finalDataToSave = { ...JSON.parse(finalEnvelopeJson), tobari_enc: true };
      } else {
          const deviceKey = await invoke<any>("get_device_public_key");
          const pubKey = await window.crypto.subtle.importKey(
              "jwk", deviceKey, { name: "ECDH", namedCurve: "P-256" }, true, []
          );
          const cborBytes = encode(wrappedData);
          const encrypted = await encryptTobariEcies(pubKey, cborBytes);
          finalDataToSave = {
              version: "1.0",
              alg: "HPKE-P256-SHA256-AES256GCM", 
              enc: encrypted.ephemeralPublicKey, 
              ciphertext: encrypted.ciphertext,
              iv: encrypted.iv,
              tag: encrypted.tag,
              tobari_enc: true
          };
      }

      await invoke("save_to_wallet", { name, docType, data: finalDataToSave });
      await loadWallet();
  };

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  return { wallet, isLoading, loadWallet, inspectItem, saveToWallet };
}
