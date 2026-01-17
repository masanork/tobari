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

  return (
    <div className="request-card">
      <h2>Sign Request</h2>
      <div className="field-group">
        <label>Service (Relying Party)</label>
        <div className="value">{request.rp_id}</div>
      </div>
      
      {request.message && (
        <div className="message-box">
          <label>Message</label>
          <p>{request.message}</p>
        </div>
      )}

      {request.bbs && (
        <div className="bbs-details" style={{marginTop: '1rem', padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px'}}>
          <label style={{fontSize: '0.8em', color: '#aaa'}}>Selective Disclosure (BBS+)</label>
          <p style={{fontSize: '0.9em', margin: '5px 0'}}>The following fields will be revealed:</p>
          <ul style={{fontSize: '0.8em', paddingLeft: '20px'}}>
            {request.bbs.revealedIndices.map(idx => (
              <li key={idx}>Field #{idx}: {request.bbs?.messages[idx]}</li>
            ))}
          </ul>
        </div>
      )}
      
      <div className="actions">
        <button className="reject-btn" onClick={onReject} disabled={isInteracting}>Reject</button>
        <div className="btn-group">
          <button className="sign-btn primary" onClick={onSign} disabled={isInteracting}>
            Passkey
          </button>
          <button className="sign-btn" onClick={onRegister} disabled={isInteracting}>
            Setup
          </button>
          <button className="sign-btn" onClick={onJpkiSign} disabled={isInteracting}>
            JPKI
          </button>
          {request.bbs && (
            <button className="sign-btn primary" onClick={onBbsProof} disabled={isInteracting}>
              ZKP
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
