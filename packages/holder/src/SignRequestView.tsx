import { SignRequest } from "./usePendingRequest";

interface SignRequestViewProps {
  request: SignRequest;
  onSign: () => void;
  onRegister: () => void;
  onJpkiSign: () => void;
  onBbsProof: () => void;
  onReject: () => void;
  status: string;
}

export function SignRequestView({ 
  request, onSign, onRegister, onJpkiSign, onBbsProof, onReject, status 
}: SignRequestViewProps) {
  const isInteracting = status.includes("Interacting") || status.includes("Generating") || status.includes("Accessing");

  // Mock disclosure items if not present, for demo purposes
  const disclosureItems = request.disclosureItems || [
    { label: "Full Name", value: "Masanori Kusunoki" },
    { label: "Date of Birth", value: "1980-01-01" },
    { label: "Credential Type", value: "Japanese My Number Card" }
  ];

  return (
    <div className="request-card">
      <div className="rp-badge">{request.rp_id}</div>
      <h2>Data Disclosure</h2>
      <p style={{color: '#888', marginBottom: '1.5rem'}}>
        The service above is requesting access to the following verified information.
      </p>
      
      <div className="disclosure-list">
        {disclosureItems.map((item, i) => (
          <div key={i} className="disclosure-item">
            <div className="disclosure-icon">✓</div>
            <div className="disclosure-text">
              <div className="disclosure-label">{item.label}</div>
              <div className="disclosure-value">{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      {request.message && (
        <div className="message-box" style={{marginTop: '1rem', background: 'rgba(100, 108, 255, 0.05)', border: '1px solid rgba(100, 108, 255, 0.2)'}}>
          <label>Purpose of Use</label>
          <p style={{fontSize: '0.9rem', margin: '4px 0'}}>{request.message}</p>
        </div>
      )}

      <div className="privacy-notice">
        🛡️ Only the items checked above will be shared. <br/>
        <strong>Other data remains private on your device.</strong>
      </div>
      
      <div className="actions">
        <div className="btn-group">
          <button className="sign-btn primary" onClick={onSign} disabled={isInteracting}>
            {request.bbs ? "Generate ZKP" : "Approve & Sign"}
          </button>
          <button className="reject-btn" onClick={onReject} disabled={isInteracting}>
            Reject
          </button>
        </div>
        
        {/* Secondary options for JPKI or Setup if needed */}
        {!request.bbs && (
          <div style={{display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '0.5rem'}}>
            <button className="sign-btn small" onClick={onJpkiSign} style={{fontSize: '0.7em', opacity: 0.6}}>Use JPKI</button>
            <button className="sign-btn small" onClick={onRegister} style={{fontSize: '0.7em', opacity: 0.6}}>New Passkey</button>
          </div>
        )}
      </div>
    </div>
  );
}