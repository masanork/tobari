import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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
}

interface DriverLicenseData {
  name: string;
  address: string;
  birth_date: string;
  issue_date: string;
  expiry_date: string;
  license_number: string;
  categories: string[];
}

interface PassportData {
  name: string;
  nationality: string;
  passport_number: string;
  birth_date: string;
  gender: string;
  expiry_date: string;
  face_photo?: string;
}

function App() {
  const [request, setRequest] = useState<SignRequest | null>(null);
  const [status, setStatus] = useState<string>("Loading...");
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<string>("");
  const [pin2, setPin2] = useState<string>("");
  const [mrz, setMrz] = useState<string>("");
  const [cardData, setCardData] = useState<any | null>(null);
  const [cardType, setCardType] = useState<string>("jpki");

// ... (omitted intermediate parts) ...

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
    <main className="container">
      <h1>Tobari Signer</h1>

      {error && (
        <div className="error-container">
          <p className="error-text">{error}</p>
        </div>
      )}

      <div className="card-selector">
        <button className={cardType === 'jpki' ? 'active' : ''} onClick={() => setCardType('jpki')}>JPKI</button>
        <button className={cardType === 'passport' ? 'active' : ''} onClick={() => setCardType('passport')}>Passport</button>
        <button className={cardType === 'license' ? 'active' : ''} onClick={() => setCardType('license')}>License</button>
        <button className={cardType === 'residence' ? 'active' : ''} onClick={() => setCardType('residence')}>Residence</button>
      </div>

      <div className="card-input-section">
        {cardType === 'jpki' && (
          <>
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
          </>
        )}
        {cardType === 'passport' && (
          <>
            <input 
              type="text" 
              placeholder="MRZ (No + Birth + Expiry)" 
              value={mrz} 
              onChange={(e) => setMrz(e.target.value)}
            />
            <button onClick={handleReadPassport} disabled={status.includes("Reading")}>
              Read Passport
            </button>
          </>
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
          <button onClick={handleReadResidenceCard} disabled={status.includes("Reading")}>
            Read Residence Card (No PIN)
          </button>
        )}
      </div>

      {cardData && (
        <div className="card-data-preview">
          <h3>Information from {cardType.toUpperCase()}</h3>
          {cardType === 'jpki' && (
            <>
              <p><strong>Name:</strong> {cardData.name}</p>
              <p><strong>Address:</strong> {cardData.address}</p>
              <p><strong>Birth Date:</strong> {cardData.birth_date}</p>
            </>
          )}
          {cardType === 'passport' && (
            <>
              <p><strong>Name:</strong> {cardData.name}</p>
              <p><strong>Nationality:</strong> {cardData.nationality}</p>
              <p><strong>Passport No:</strong> {cardData.passport_number}</p>
              <p><strong>Expiry:</strong> {cardData.expiry_date}</p>
            </>
          )}
          {cardType === 'license' && (
            <>
              <p><strong>Name:</strong> {cardData.name}</p>
              <p><strong>Address:</strong> {cardData.address}</p>
              <p><strong>License No:</strong> {cardData.license_number}</p>
              <p><strong>Categories:</strong> {cardData.categories.join(", ")}</p>
            </>
          )}
          {cardType === 'residence' && (
            <pre className="raw-json">{JSON.stringify(cardData, null, 2)}</pre>
          )}
          {cardData.face_photo && (
            <img src={`data:image/jpeg;base64,${cardData.face_photo}`} alt="Face" style={{width: 100, marginTop: 10, borderRadius: 8}} />
          )}
        </div>
      )}

      {request ? (
        <div className="request-card">
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
          
          <div className="status-message">{status}</div>

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
        <div className="loading">
          <p>{status}</p>
          {!error && <button className="reject-btn" onClick={handleReject}>Close</button>}
        </div>
      )}
    </main>
  );
}

export default App;
