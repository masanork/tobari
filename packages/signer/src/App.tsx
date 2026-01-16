import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { encryptTobariEcies, encodeCanonical as encode, decode } from "@tobari/crypto";
import init, { create_envelope, add_prf_recipient, decrypt_envelope_with_prf } from "@tobari/civ";
import { registerPasskeyWithPrf, getPrfOutput, bufferToHex, hexToBuffer } from "./webauthn";
import "./App.css";

interface SignRequest {
  challenge: string;
  rp_id: string;
  user_verification?: string;
  message?: string;
  allow_credentials?: { id: string; type_: string }[];
  bbs?: {
    publicKey: string;
    signature: string;
    messages: string[];
    revealedIndices: number[];
  };
}

interface MyNumberCardData {
  name: string;
  address: string;
  birth_date: string;
  gender: string;
  my_number: string;
  face_photo?: string;
  face_photo_format?: string;
  auth_cert?: string;
  sign_cert?: string;
  auth_ca_cert?: string;
  sign_ca_cert?: string;
}

interface DriverLicenseData {
  name: string;
  name_kana?: string;
  address: string;
  birth_date: string;
  issue_date: string;
  expire_date: string;
  license_number: string;
  face_photo?: string;
  face_photo_format?: string;
  signature?: string;
  raw_data_group1?: string;
}

interface PassportData {
  dg1: string;
  dg2: string;
  mrz?: string;
  name?: string;
  nationality?: string;
  passport_number?: string;
  birth_date?: string;
  gender?: string;
  expiry_date?: string;
  face_photo?: string;
  face_photo_format?: string;
  sod?: string;
  dg11?: string;
  dg12?: string;
  dg14?: string;
  dg15?: string;
}

interface WalletCredential {
  name: string;
  path: string;
  doc_type: string;
  created_at?: number;
}

function App() {
  const [request, setRequest] = useState<SignRequest | null>(null);
  const [status, setStatus] = useState<string>("Loading...");
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<string>("");
  const [pin2, setPin2] = useState<string>("");
  const [mrz, setMrz] = useState<string>("");
  const [cardData, setCardData] = useState<any | null>(null);
  const [cardType, setCardType] = useState<string>("wallet"); // Default to Wallet
  const [wallet, setWallet] = useState<WalletCredential[]>([]);
  const [usePasskey, setUsePasskey] = useState<boolean>(false);
  const [passkeyId, setPasskeyId] = useState<string | null>(localStorage.getItem("tobari_passkey_id"));

  useEffect(() => {
    // Initialize WASM
    init().catch(console.error);
  }, []);

  const normalizeBase64 = (input: string) => {
    let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const padding = base64.length % 4;
    if (padding) {
      base64 += "=".repeat(4 - padding);
    }
    return base64;
  };

  const estimateBase64Bytes = (input: string) => {
    const normalized = normalizeBase64(input);
    const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  };

  const licensePhotoBase64 = cardData?.face_photo ? normalizeBase64(cardData.face_photo) : null;
  
  // Robust mime type detection
  let facePhotoMime = "image/jpeg"; // Default fallback
  
  if (cardData?.face_photo_format) {
      // Trust the format from backend if provided
      facePhotoMime = `image/${cardData.face_photo_format}`;
  } else if (cardType === "license") {
      // Backend converts license photos to jpeg on macOS
      facePhotoMime = "image/jpeg";
  }

  // Log photo details if present
  useEffect(() => {
      if (cardData?.face_photo) {
          console.log(`Photo loaded: ${estimateBase64Bytes(cardData.face_photo)} bytes`);
          console.log(`Backend Format: ${cardData.face_photo_format}`);
          console.log(`Resolved Mime: ${facePhotoMime}`);
          console.log(`Src Prefix: data:${facePhotoMime};base64,${licensePhotoBase64?.substring(0, 20)}...`);
      }
  }, [cardData, facePhotoMime, licensePhotoBase64]);

  const passportPhotoBase64 = cardData?.face_photo && cardType === 'passport'
    ? normalizeBase64(cardData.face_photo)
    : cardData?.dg2 && cardType === 'passport'
    ? normalizeBase64(cardData.dg2)
    : null;

  // Determine the photo source to display
  let displayPhotoSrc: string | null = null;
  
  if (passportPhotoBase64) {
      displayPhotoSrc = `data:${facePhotoMime};base64,${passportPhotoBase64}`;
  } else if (licensePhotoBase64 && (cardType === 'license' || cardType === 'jpki')) {
      // For License and JPKI, use the standard face_photo field
      displayPhotoSrc = `data:${facePhotoMime};base64,${licensePhotoBase64}`;
  }

  const loadWallet = async () => {
    try {
      const items = await invoke<WalletCredential[]>("get_wallet_credentials");
      setWallet(items);
    } catch (e) {
      console.error("Failed to load wallet", e);
    }
  };

  useEffect(() => {
    loadWallet();
  }, []);

  const handleInspectWalletItem = async (cred: WalletCredential) => {
    setStatus(`Inspecting ${cred.name}...`);
    setError(null);
    try {
      const details = await invoke<any>("inspect_wallet_file", { path: cred.path });
      let displayData = details;
      
      // Automatic decryption for device-bound items
      if (details && details.tobari_enc === true) {
          if (details.version === "2.0") {
              // Envelope v2.0
              const prfRecipient = details.recipients?.find((r: any) => r.type === "webauthn-prf");
              if (prfRecipient) {
                  setStatus(`Decrypting ${cred.name} using Passkey PRF...`);
                  try {
                      const salt = hexToBuffer(prfRecipient.salt);
                      const prfOutput = await getPrfOutput(hexToBuffer(prfRecipient.kid), salt);
                      const decryptedBytes = await decrypt_envelope_with_prf(JSON.stringify(details), prfRecipient.kid, prfOutput);
                      
                      // Decode CBOR from decrypted bytes
                      displayData = decode(decryptedBytes);
                      setStatus(`Decrypted ${cred.name} with Passkey`);
                  } catch (de: any) {
                      console.error("Passkey Decryption failed", de);
                      setStatus(`Passkey Decryption failed: ${de.toString()}`);
                  }
              } else {
                  // Fallback to native decryption if no PRF recipient
                  setStatus(`Decrypting ${cred.name} using native key...`);
                  displayData = await invoke("decrypt_data", { data: details });
              }
          } else {
              // Old ECIES format
              setStatus(`Decrypting ${cred.name} using device key...`);
              try {
                  displayData = await invoke("decrypt_data", { data: details });
                  setStatus(`Decrypted ${cred.name}`);
              } catch (de: any) {
                  console.error("Decryption failed", de);
                  setStatus(`Decryption failed: ${de.toString()}`);
              }
          }
      } else {
          setStatus(`Loaded details for ${cred.name}`);
      }

      setCardData({
        ...cred,
        _is_wallet_item: true,
        raw_structure: details,
        decrypted_data: displayData
      });
    } catch (e: any) {
       console.error(e);
       setCardData({
          ...cred,
          _is_wallet_item: true,
          error: "Failed to inspect file structure"
       });
       setError("Failed to inspect file: " + e.toString());
    }
  };

  const handleReadPassport = async () => {
    if (mrz.length < 20) {
      setError("Please enter a valid MRZ (Passport No + Birth Date + Expiry Date).");
      return;
    }
    setStatus("Reading Passport... Please wait.");
    setError(null);
    try {
      const data = await invoke<PassportData>("read_passport", { request: { mrz } });
      setCardData(data);
      setStatus("Passport read successfully!");
    } catch (e: any) {
      setError("Failed to read passport: " + formatError(e));
      setStatus("Error");
    }
  };

  const handleReadDriverLicense = async () => {
    if (!pin || !pin2) {
      setError("Please enter both PIN1 and PIN2.");
      return;
    }
    setStatus("Reading Driver License... Please wait.");
    setError(null);
    try {
      const data = await invoke<DriverLicenseData>("read_driver_license", { request: { pin1: pin, pin2 } });
      setCardData(data);
      setStatus("Driver License read successfully!");
    } catch (e: any) {
      setError("Failed to read driver license: " + formatError(e));
      setStatus("Error");
    }
  };

  const handleReadResidenceCard = async () => {
    setStatus("Reading Residence Card... Please wait.");
    setError(null);
    try {
      const data = await invoke<any>("read_residence_card");
      setCardData(data);
      setStatus("Residence Card read successfully!");
    } catch (e: any) {
      setError("Failed to read residence card: " + formatError(e));
      setStatus("Error");
    }
  };

  const formatError = (e: any): string => {
    if (typeof e === 'string') return e;
    if (e.type === "IncorrectPin") {
      return `Incorrect PIN. ${e.details.retries} attempts remaining. Please be careful as the card will be locked after 3 or 5 failures.`;
    }
    if (e.type === "PinLocked") {
      return "The PIN is locked. You must visit your local municipal office to reset it.";
    }
    return JSON.stringify(e);
  };

  useEffect(() => {
    invoke<SignRequest | null>("get_pending_request")
      .then((req) => {
        if (req) {
          setRequest(req);
          setStatus("Waiting for user approval");
        } else {
          setStatus("No pending request found.");
          // Don't show error immediately if we just want to read card
          // setError("Please launch this app via the Tobari MCP Server.");
        }
      })
      .catch((e) => {
        setError("Failed to load request: " + formatError(e));
      });
  }, []);

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

  const handleJpkiSign = async () => {
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

  const handleReadCard = async () => {
    if (!pin) {
      setError("Please enter your 4-digit PIN.");
      return;
    }
    setStatus("Reading My Number Card... Please wait.");
    setError(null);
    try {
      const data = await invoke<MyNumberCardData>("read_my_number_card", { 
        request: { pin } 
      });
      setCardData(data);
      setStatus("Card read successfully!");
    } catch (e: any) {
      setError("Failed to read card: " + formatError(e));
      setStatus("Error");
    }
  };

  const calculateIdentityHash = async (data: any, type: string): Promise<string> => {
      // Create a stable string representation of identity attributes
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
      return hashHex.substring(0, 16); // Use first 16 chars
  };

  const handleSaveToWallet = async () => {
    if (!cardData) return;
    setStatus("Saving to Wallet...");
    try {
      // Generate ID from content hash
      const idHash = await calculateIdentityHash(cardData, cardType);
      
      let name = "Document";
      let docType = "unknown";

      if (cardType === 'jpki') {
        name = `MyNumberCard_${idHash}`;
        docType = "io.github.masanork.tobari.mynumber.v1";
      } else if (cardType === 'passport') {
        name = `Passport_${idHash}`;
        docType = "org.icao.dtc.v1";
      } else if (cardType === 'license') {
        name = `DriverLicense_${idHash}`;
        docType = "io.github.masanork.tobari.driver_license.v1";
      }

      // 1. Prepare data for CDDL/CBOR structure
      // Convert Base64 strings to Uint8Array where appropriate
      const prepareData = (data: any) => {
          const result = { ...data };
          const binaryFields = [
              'face_photo', 'auth_cert', 'sign_cert', 'auth_ca_cert', 'sign_ca_cert',
              'dg1', 'dg2', 'sod', 'dg11', 'dg12', 'dg14', 'dg15',
              'signature', 'raw_data_group1'
          ];
          for (const field of binaryFields) {
              if (result[field] && typeof result[field] === 'string') {
                  try {
                      // Attempt to decode base64url or base64
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

      const wrappedData = {
          version: "1.0",
          docType,
          data: prepareData(cardData)
      };

      // 2. Encrypt for Device Binding
      let finalDataToSave: any = null;

      if (usePasskey) {
          setStatus("Creating Passkey-protected envelope...");
          try {
              if (!passkeyId) {
                  setStatus("Please register a Passkey first.");
                  return;
              }
              const salt = window.crypto.getRandomValues(new Uint8Array(32));
              const prfOutput = await getPrfOutput(hexToBuffer(passkeyId), salt);
              
              // Use WASM to create envelope
              // Use Canonical CBOR for the payload
              const payload = encode(wrappedData);
              const { envelope: initialEnvelopeJson, dek } = await create_envelope(payload);
              
              const finalEnvelopeJson = await add_prf_recipient(
                  initialEnvelopeJson,
                  dek,
                  passkeyId,
                  salt,
                  prfOutput
              );
              
              finalDataToSave = {
                  ...JSON.parse(finalEnvelopeJson),
                  tobari_enc: true
              };
          } catch (e) {
              console.error("Passkey Encryption failed:", e);
              setError("Passkey Encryption failed: " + e);
              return;
          }
      } else {
          try {
            setStatus(`Fetching device binding key...`);
            const deviceKey = await invoke<any>("get_device_public_key");
            
            setStatus(`Encrypting for device bind key...`);
            const pubKey = await window.crypto.subtle.importKey(
                "jwk",
                deviceKey,
                { name: "ECDH", namedCurve: "P-256" },
                true,
                []
            );

            // Encode CDDL-compliant structure to CBOR
            const cborBytes = encode(wrappedData);
            
            // Encrypt using Tobari ECIES (compatible with Rust backend)
            const encrypted = await encryptTobariEcies(pubKey, cborBytes);
            
            // Following ENCRYPTION_SPEC.md storage format
            finalDataToSave = {
                version: "1.0",
                alg: "HPKE-P256-SHA256-AES256GCM", 
                enc: encrypted.ephemeralPublicKey, 
                ciphertext: encrypted.ciphertext,
                iv: encrypted.iv,
                tag: encrypted.tag,
                tobari_enc: true
            };
          } catch (e) {
              console.error("Native Encryption failed:", e);
              setError("Native Encryption failed: " + e);
              return;
          }
      }

      await invoke("save_to_wallet", {
        name,
        docType,
        data: finalDataToSave
      });
      setStatus("Saved to Wallet!");
      setCardData(null);
      setCardType('wallet');
      loadWallet();
    } catch (e: any) {
      setError("Failed to save: " + e.toString());
    }
  };

  const handleRegisterPasskey = async () => {
      setStatus("Registering Passkey with PRF...");
      try {
          const id = await registerPasskeyWithPrf("user@tobari.local");
          const hexId = bufferToHex(id);
          setPasskeyId(hexId);
          localStorage.setItem("tobari_passkey_id", hexId);
          setStatus("Passkey registered successfully!");
      } catch (e: any) {
          console.error(e);
          setError("Passkey registration failed: " + e.message);
      }
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

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h1>Tobari Signer</h1>
        
        <div className="card-selector">
          <button className={cardType === 'wallet' ? 'active' : ''} onClick={() => { setCardType('wallet'); loadWallet(); }}>Wallet</button>
          <button className={cardType === 'jpki' ? 'active' : ''} onClick={() => setCardType('jpki')}>JPKI</button>
          <button className={cardType === 'passport' ? 'active' : ''} onClick={() => setCardType('passport')}>Passport</button>
          <button className={cardType === 'license' ? 'active' : ''} onClick={() => setCardType('license')}>License</button>
          <button className={cardType === 'residence' ? 'active' : ''} onClick={() => setCardType('residence')}>Residence</button>
        </div>

        <div className="settings-section" style={{padding: '10px 20px', borderBottom: '1px solid #333'}}>
            <label style={{display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer'}}>
                <input type="checkbox" checked={usePasskey} onChange={(e) => setUsePasskey(e.target.checked)} />
                <span>Use Passkey (PRF)</span>
            </label>
            {usePasskey && !passkeyId && (
                <button className="sign-btn small" onClick={handleRegisterPasskey} style={{marginTop: '10px'}}>Setup Passkey</button>
            )}
            {usePasskey && passkeyId && (
                <div style={{fontSize: '0.7em', color: '#888', marginTop: '5px'}}>Passkey active: {passkeyId.substring(0, 8)}...</div>
            )}
        </div>

        <div className="card-input-section">
          {cardType === 'wallet' && (
            <div className="wallet-view">
              {wallet.length === 0 ? (
                <p className="empty-wallet">Your wallet is empty. Scan a card to add it.</p>
              ) : (
                <div className="credential-grid">
                  {wallet.map((cred, i) => (
                    <div key={i} className="credential-card" onClick={() => handleInspectWalletItem(cred)}>
                      <div className="cred-icon">
                        {cred.doc_type.includes('passport') ? '🛂' : 
                         cred.doc_type.includes('license') ? '🪪' : 
                         cred.doc_type.includes('resident') ? '🏠' : 
                         cred.doc_type.includes('mynumber') ? '💳' : '📄'}
                      </div>
                      <div className="cred-info">
                        <div className="cred-name">{cred.name}</div>
                        <div className="cred-type">{cred.doc_type}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button className="refresh-btn" onClick={loadWallet}>Refresh Wallet</button>
            </div>
          )}
          {cardType === 'jpki' && (
            <div className="input-group">
              <input 
                type="password" 
                placeholder="4-digit PIN" 
                value={pin} 
                onChange={(e) => setPin(e.target.value)}
                maxLength={16}
              />
              <button onClick={handleReadCard} disabled={status.includes("Reading")}>
                Read Card
              </button>
            </div>
          )}
          {cardType === 'passport' && (
            <div className="input-group">
              <input 
                type="text" 
                placeholder="MRZ (No + Birth + Expiry)" 
                value={mrz} 
                onChange={(e) => setMrz(e.target.value)}
              />
              <button onClick={handleReadPassport} disabled={status.includes("Reading")}>
                Read Passport
              </button>
            </div>
          )}
          {cardType === 'license' && (
            <div className="vertical-inputs">
              <input type="password" placeholder="PIN1 (4 digits)" value={pin} onChange={(e) => setPin(e.target.value)} />
              <input type="password" placeholder="PIN2 (4 digits)" value={pin2} onChange={(e) => setPin2(e.target.value)} />
              <button onClick={handleReadDriverLicense} disabled={status.includes("Reading")}>
                Read License
              </button>
            </div>
          )}
          {cardType === 'residence' && (
            <div className="input-group">
              <button onClick={handleReadResidenceCard} disabled={status.includes("Reading")}>
                Read Residence Card (No PIN)
              </button>
            </div>
          )}
        </div>
        
        <div className="status-bar">
           <div className="status-message">{status}</div>
           {!request && !error && <button className="reject-btn small" onClick={handleReject}>Close App</button>}
        </div>

      </aside>

      <section className="content-area">
        {error && (
          <div className="error-container">
            <p className="error-text">{error}</p>
          </div>
        )}

        {cardData ? (
          <div className="card-data-preview">
            <h3>Information from {cardType.toUpperCase()}</h3>
            {cardType === 'jpki' && (
              <div className="preview-grid">
                <div className="preview-item"><strong>Name:</strong> {cardData.name}</div>
                <div className="preview-item"><strong>Address:</strong> {cardData.address}</div>
                <div className="preview-item"><strong>Birth Date:</strong> {cardData.birth_date}</div>
                <div className="preview-item"><strong>Gender:</strong> {cardData.gender}</div>
                <div className="preview-item"><strong>My Number:</strong> {cardData.my_number}</div>
                {(cardData.auth_cert || cardData.sign_cert) && (
                   <div className="preview-full">
                      <strong>Certificates:</strong>
                      <div className="cert-list">
                         {cardData.auth_cert && <details><summary>Authentication Certificate</summary><pre className="raw-json">{cardData.auth_cert}</pre></details>}
                         {cardData.sign_cert && <details><summary>Digital Signature Certificate</summary><pre className="raw-json">{cardData.sign_cert}</pre></details>}
                      </div>
                   </div>
                )}
              </div>
            )}
            {cardType === 'passport' && (
              <div className="preview-grid">
                {cardData.name && (
                  <>
                    <div className="preview-item"><strong>Name:</strong> {cardData.name}</div>
                    <div className="preview-item"><strong>Passport No:</strong> {cardData.passport_number}</div>
                    <div className="preview-item"><strong>Birth Date:</strong> {cardData.birth_date}</div>
                    <div className="preview-item"><strong>Expiry Date:</strong> {cardData.expiry_date}</div>
                    <div className="preview-item"><strong>Nationality:</strong> {cardData.nationality}</div>
                    <div className="preview-item"><strong>Gender:</strong> {cardData.gender}</div>
                  </>
                )}
                {cardData.mrz && (
                  <div className="preview-full">
                    <strong>MRZ:</strong>
                    <pre className="raw-json">{cardData.mrz}</pre>
                  </div>
                )}
                <div className="preview-full">
                    <strong>Security & Metadata:</strong>
                    <div className="cert-list">
                       {cardData.sod && <details><summary>Security Object (SOD)</summary><pre className="raw-json">{cardData.sod}</pre></details>}
                       {cardData.dg11 && <details><summary>Additional Info (DG11)</summary><pre className="raw-json">{cardData.dg11}</pre></details>}
                       {cardData.dg12 && <details><summary>Issuing Authority Info (DG12)</summary><pre className="raw-json">{cardData.dg12}</pre></details>}
                    </div>
                </div>
              </div>
            )}
            {cardType === 'license' && (
              <div className="preview-grid">
                {cardData.name ? (
                  <>
                    <div className="preview-item"><strong>Name:</strong> {cardData.name}</div>
                    {cardData.name_kana && <div className="preview-item"><strong>Kana:</strong> {cardData.name_kana}</div>}
                    <div className="preview-item"><strong>Address:</strong> {cardData.address}</div>
                    <div className="preview-item"><strong>License No:</strong> {cardData.license_number}</div>
                    <div className="preview-item"><strong>Birth Date:</strong> {cardData.birth_date}</div>
                    <div className="preview-item"><strong>Expiry Date:</strong> {cardData.expire_date}</div>
                  </>
                ) : (
                  <pre className="raw-json">{JSON.stringify(cardData, null, 2)}</pre>
                )}
                {(cardData.signature || cardData.raw_data_group1) && (
                   <div className="preview-full">
                      <strong>Raw Data & Signature:</strong>
                      <div className="cert-list">
                         {cardData.signature && <details><summary>Issuer Signature</summary><pre className="raw-json">{cardData.signature}</pre></details>}
                         {cardData.raw_data_group1 && <details><summary>EF01 (Common Data) Raw Bytes</summary><pre className="raw-json">{cardData.raw_data_group1}</pre></details>}
                      </div>
                   </div>
                )}
              </div>
            )}
            {cardType === 'residence' && (
              <div className="preview-grid">
                <pre className="raw-json">{JSON.stringify(cardData, null, 2)}</pre>
              </div>
            )}
            {cardData._is_wallet_item && (
               <div className="preview-grid">
                  <div className="preview-item"><strong>Name:</strong> {cardData.name}</div>
                  <div className="preview-item"><strong>Type:</strong> {cardData.doc_type}</div>
                  <div className="preview-item"><strong>Added:</strong> {new Date(cardData.created_at * 1000).toLocaleString()}</div>
                  <div className="preview-full">
                     <strong>Storage Path:</strong>
                     <code style={{fontSize: '0.8em', opacity: 0.7}}>{cardData.path}</code>
                  </div>
                  {cardData.decrypted_data && (
                    <div className="preview-full">
                        <strong>Decrypted Data:</strong>
                        <pre className="raw-json">{JSON.stringify(cardData.decrypted_data, null, 2)}</pre>
                    </div>
                  )}
                  {cardData.raw_structure && (
                    <div className="preview-full">
                        <strong>Storage Container (CBOR):</strong>
                        <div className="cert-list">
                           <details>
                              <summary>View Encrypted Envelope</summary>
                              <pre className="raw-json">{JSON.stringify(cardData.raw_structure, null, 2)}</pre>
                           </details>
                        </div>
                    </div>
                  )}
               </div>
            )}
            
            {displayPhotoSrc && (
              <div className="photo-container">
                <p style={{fontSize: '0.7em', color: '#888'}}>
                    Photo data present ({estimateBase64Bytes(cardData.face_photo || cardData.dg2 || "")} bytes)
                </p>
                <img 
                  src={displayPhotoSrc} 
                  alt="Face" 
                  style={{width: 150, marginTop: 10, borderRadius: 8, border: '1px solid #444'}} 
                  onError={(e) => {
                    console.error("Photo render error", e);
                    if (!displayPhotoSrc?.startsWith('data:image/jpeg')) {
                        (e.target as HTMLImageElement).src = displayPhotoSrc!.replace(/image\/[a-z0-9]+/, 'image/jpeg');
                    }
                  }}
                />
              </div>
            )}
            
            {!cardData._is_wallet_item && (
                <div style={{marginTop: '1.5rem', display: 'flex', gap: '0.5rem'}}>
                    <button className="sign-btn primary" onClick={handleSaveToWallet}>
                    Save to Wallet
                    </button>
                    <button className="reject-btn" onClick={() => setCardData(null)}>
                    Dismiss
                    </button>
                </div>
            )}
          </div>
        ) : request ? (
          <div className="request-card">
            <h2>Sign Request</h2>
            <div className="field-group">
              <label>Relying Party (Service)</label>
              <div className="value">{request.rp_id}</div>
            </div>
            
                      {request.message && (
                         <div className="message-box">
                           <label>Message from Service</label>
                           <p>{request.message}</p>
                         </div>
                      )}
            
                      {request.bbs && (
                        <div className="bbs-details">
                          <label>Selective Disclosure (BBS+)</label>
                          <p>The following fields will be revealed:</p>
                          <ul>
                            {request.bbs.revealedIndices.map(idx => (
                              <li key={idx}>Field #{idx}: {request.bbs?.messages[idx]}</li>
                            ))}
                          </ul>
                          <p className="privacy-note">Other fields and the issuer's signature will remain hidden.</p>
                        </div>
                      )}
            
                      <div className="details">            <details>
                <summary>Technical Details</summary>
                <div className="detail-content">
                  <p><strong>Challenge:</strong> {request.challenge.substring(0, 20)}...</p>
                  <p><strong>User Verification:</strong> {request.user_verification || "preferred"}</p>
                </div>
              </details>
            </div>
            
            <div className="actions">
              <button className="reject-btn" onClick={handleReject} disabled={status.includes("Interacting")}>
                Reject
              </button>
              <div className="btn-group">
                <button className="sign-btn primary" onClick={handleSign} disabled={status.includes("Interacting")}>
                  Passkey (Touch ID/Key)
                </button>
                <button className="sign-btn" onClick={handleRegister} disabled={status.includes("Interacting")}>
                  Setup Passkey
                </button>
                <button className="sign-btn" onClick={handleJpkiSign} disabled={!pin || status.includes("Interacting")}>
                  JPKI (My Number Card)
                </button>
                {request.bbs && (
                  <button className="sign-btn primary" onClick={handleBbsProof} disabled={status.includes("Generating")}>
                    Generate ZKP (BBS+)
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
            <div className="placeholder-state">
                <div className="placeholder-icon">👋</div>
                <p>Select an action from the sidebar or wait for a request.</p>
            </div>
        )}
      </section>
    </div>
  );
}

export default App;
