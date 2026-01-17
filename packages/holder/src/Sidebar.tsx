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
  onDetectCard: () => void;
  status: string;
  onReject: () => void;
  hasRequest: boolean;
  hasError: boolean;
}

export function Sidebar({
  cardType, setCardType, usePasskey, setUsePasskey, passkeyId, onRegisterPasskey,
  wallet, onWalletItemClick, pin, setPin, pin2, setPin2, mrz, setMrz,
  onReadJPKI, onReadPassport, onReadLicense, onReadResidence, onDetectCard,
  status, onReject, hasRequest, hasError
}: SidebarProps) {
  const isReading = status.includes("Reading") || status.includes("Detecting");
  const isWallet = cardType === 'wallet';
  const isAddMode = !isWallet;

  return (
    <aside className="sidebar">
      <h1>Tobari Holder</h1>
      
      <div className="card-selector" style={{display: 'flex', gap: '10px', marginBottom: '20px'}}>
        <button 
          className={isWallet ? 'active' : ''} 
          onClick={() => setCardType('wallet')}
          style={{flex: 1}}
        >
          Wallet
        </button>
        <button 
          className={isAddMode ? 'active' : ''} 
          onClick={() => setCardType('add')}
          style={{flex: 1}}
        >
          Add ID
        </button>
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
        {isWallet && (
          <div className="wallet-view">
            <CredentialGrid wallet={wallet} onItemClick={onWalletItemClick} />
          </div>
        )}

        {isAddMode && (
           <div className="add-id-container">
             {cardType === 'add' && (
               <div style={{textAlign: 'center', padding: '20px'}}>
                 <div style={{fontSize: '3rem', marginBottom: '1rem'}}>🪪</div>
                 <p style={{marginBottom: '1rem', color: '#888'}}>Place your card on the reader</p>
                 <button className="sign-btn primary" onClick={onDetectCard} disabled={isReading}>
                   {isReading ? 'Scanning...' : 'Scan Card'}
                 </button>
                 <div style={{marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1rem'}}>
                    <p style={{fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem'}}>Or select manually:</p>
                    <div style={{display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'center'}}>
                        <button className="sign-btn small" onClick={() => setCardType('jpki')}>JPKI</button>
                        <button className="sign-btn small" onClick={() => setCardType('passport')}>Passport</button>
                        <button className="sign-btn small" onClick={() => setCardType('license')}>License</button>
                    </div>
                 </div>
               </div>
             )}

            {cardType === 'jpki' && (
              <div className="input-group">
                <h3>My Number Card</h3>
                <input type="password" placeholder="4-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
                <button onClick={onReadJPKI} disabled={isReading}>Read Card</button>
                <button className="reject-btn small" onClick={() => setCardType('add')} style={{marginTop: '10px'}}>Back</button>
              </div>
            )}
            {cardType === 'passport' && (
              <div className="input-group">
                <h3>Passport</h3>
                <input type="text" placeholder="MRZ" value={mrz} onChange={(e) => setMrz(e.target.value)} />
                <button onClick={onReadPassport} disabled={isReading}>Read Passport</button>
                <button className="reject-btn small" onClick={() => setCardType('add')} style={{marginTop: '10px'}}>Back</button>
              </div>
            )}
            {cardType === 'license' && (
              <div className="vertical-inputs">
                <h3>Driver's License</h3>
                <input type="password" placeholder="PIN1" value={pin} onChange={(e) => setPin(e.target.value)} />
                <input type="password" placeholder="PIN2" value={pin2} onChange={(e) => setPin2(e.target.value)} />
                <button onClick={onReadLicense} disabled={isReading}>Read License</button>
                <button className="reject-btn small" onClick={() => setCardType('add')} style={{marginTop: '10px'}}>Back</button>
              </div>
            )}
            {cardType === 'residence' && (
              <div className="input-group">
                <h3>Residence Card</h3>
                <button onClick={onReadResidence} disabled={isReading}>Read Residence Card</button>
                <button className="reject-btn small" onClick={() => setCardType('add')} style={{marginTop: '10px'}}>Back</button>
              </div>
            )}
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
