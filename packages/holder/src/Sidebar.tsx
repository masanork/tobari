import { CredentialGrid } from "./CredentialGrid";
import { WalletCredential } from "./useWallet";

interface SidebarProps {
  cardType: string;
  setCardType: (type: string) => void;
  usePasskey: boolean;
  setUsePasskey: (use: boolean) => void;
  passkeyId: string | null;
  onRegisterPasskey: () => void;
  wallet: WalletCredential[];
  onWalletItemClick: (cred: WalletCredential) => void;
  pin: string;
  setPin: (val: string) => void;
  pin2: string;
  setPin2: (val: string) => void;
  mrz: string;
  setMrz: (val: string) => void;
  onReadJPKI: () => void;
  onReadPassport: () => void;
  onReadLicense: () => void;
  onReadResidence: () => void;
  status: string;
  onReject: () => void;
  hasRequest: boolean;
  hasError: boolean;
}

export function Sidebar({
  cardType, setCardType, usePasskey, setUsePasskey, passkeyId, onRegisterPasskey,
  wallet, onWalletItemClick, pin, setPin, pin2, setPin2, mrz, setMrz,
  onReadJPKI, onReadPassport, onReadLicense, onReadResidence,
  status, onReject, hasRequest, hasError
}: SidebarProps) {
  const isReading = status.includes("Reading");

  return (
    <aside className="sidebar">
      <h1>Tobari Holder</h1>
      
      <div className="card-selector">
        {['wallet', 'jpki', 'passport', 'license', 'residence'].map(type => (
          <button 
            key={type}
            className={cardType === type ? 'active' : ''} 
            onClick={() => setCardType(type)}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      <div className="settings-section">
          <label style={{display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '10px 20px'}}>
              <input type="checkbox" checked={usePasskey} onChange={(e) => setUsePasskey(e.target.checked)} />
              <span>Use Passkey (PRF)</span>
          </label>
          {usePasskey && !passkeyId && (
              <button className="sign-btn small" onClick={onRegisterPasskey} style={{margin: '0 20px 10px'}}>Setup Passkey</button>
          )}
      </div>

      <div className="card-input-section">
        {cardType === 'wallet' && (
          <div className="wallet-view">
            <CredentialGrid wallet={wallet} onItemClick={onWalletItemClick} />
          </div>
        )}
        {cardType === 'jpki' && (
          <div className="input-group">
            <input type="password" placeholder="4-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
            <button onClick={onReadJPKI} disabled={isReading}>Read Card</button>
          </div>
        )}
        {cardType === 'passport' && (
          <div className="input-group">
            <input type="text" placeholder="MRZ" value={mrz} onChange={(e) => setMrz(e.target.value)} />
            <button onClick={onReadPassport} disabled={isReading}>Read Passport</button>
          </div>
        )}
        {cardType === 'license' && (
          <div className="vertical-inputs">
            <input type="password" placeholder="PIN1" value={pin} onChange={(e) => setPin(e.target.value)} />
            <input type="password" placeholder="PIN2" value={pin2} onChange={(e) => setPin2(e.target.value)} />
            <button onClick={onReadLicense} disabled={isReading}>Read License</button>
          </div>
        )}
        {cardType === 'residence' && (
          <div className="input-group">
            <button onClick={onReadResidence} disabled={isReading}>Read Residence Card</button>
          </div>
        )}
      </div>
      
      <div className="status-bar">
         <div className="status-message">{status}</div>
         {!hasRequest && !hasError && <button className="reject-btn small" onClick={onReject}>Close App</button>}
      </div>
    </aside>
  );
}
