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

function App() {
  const [request, setRequest] = useState<SignRequest | null>(null);
  const [status, setStatus] = useState<string>("Loading...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<SignRequest | null>("get_pending_request")
      .then((req) => {
        if (req) {
          setRequest(req);
          setStatus("Waiting for user approval");
        } else {
          setStatus("No pending request found.");
          setError("Please launch this app via the Tobari MCP Server.");
        }
      })
      .catch((e) => {
        setError("Failed to load request: " + e);
      });
  }, []);

  const handleSign = async () => {
    setStatus("Interacting with authenticator... Please touch your device.");
    setError(null);
    try {
      await invoke("perform_sign");
      setStatus("Signed successfully! Closing...");
    } catch (e) {
      setError("Signing failed: " + e);
      setStatus("Error");
    }
  };

  const handleRegister = async () => {
    setStatus("Registering credential... Please touch your device.");
    setError(null);
    try {
      const credId = await invoke<string>("perform_register");
      setStatus(`Registered. Credential ID: ${credId.substring(0, 10)}... Now sign.`);
    } catch (e) {
      setError("Registration failed: " + e);
      setStatus("Error");
    }
  };

  const handleReject = async () => {
    await invoke("reject");
  };

  return (
    <main className="container">
      <h1>Tobari Signer</h1>

      {error ? (
        <div className="error-container">
          <p className="error-text">{error}</p>
          <button onClick={handleReject}>Close</button>
        </div>
      ) : request ? (
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
            <button className="sign-btn" onClick={handleRegister} disabled={status.includes("Interacting")}>
              Create Passkey
            </button>
            <button className="sign-btn" onClick={handleSign} disabled={status.includes("Interacting")}>
              Sign with Authenticator
            </button>
          </div>
        </div>
      ) : (
        <div className="loading">
          <p>{status}</p>
        </div>
      )}
    </main>
  );
}

export default App;
