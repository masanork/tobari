import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface SignRequest {
  challenge: string;
  rp_id: string;
  user_verification?: string;
  message?: string;
  allow_credentials?: { id: string; type_: string }[];
}

interface MyNumberCardData {
  name: string;
  address: string;
  birth_date: string;
  gender: string;
  my_number: string;
  face_photo?: string;
}

function App() {
  const [request, setRequest] = useState<SignRequest | null>(null);
  const [status, setStatus] = useState<string>("Loading...");
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<string>("");
  const [cardData, setCardData] = useState<MyNumberCardData | null>(null);

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

      <div className="card-input-section">
        <input 
          type="password" 
          placeholder="PIN (4 or 6-16 digits)" 
          value={pin} 
          onChange={(e) => setPin(e.target.value)}
          maxLength={16}
        />
        <button onClick={handleReadCard} disabled={status.includes("Reading")}>
          Read My Number Card
        </button>
      </div>

      {cardData && (
        <div className="card-data-preview">
          <h3>Card Information</h3>
          <p><strong>Name:</strong> {cardData.name}</p>
          <p><strong>Address:</strong> {cardData.address}</p>
          <p><strong>Birth Date:</strong> {cardData.birth_date}</p>
          <p><strong>Gender:</strong> {cardData.gender}</p>
          {cardData.face_photo && (
            <img src={`data:image/jpeg;base64,${cardData.face_photo}`} alt="Face" style={{width: 100}} />
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
          
          <div className="details">
            <details>
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
