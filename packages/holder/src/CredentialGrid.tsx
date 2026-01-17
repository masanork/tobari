import { WalletCredential } from "./useWallet";

interface CredentialGridProps {
  wallet: WalletCredential[];
  onItemClick: (cred: WalletCredential) => void;
}

export function CredentialGrid({ wallet, onItemClick }: CredentialGridProps) {
  if (wallet.length === 0) {
    return <p className="empty-wallet">Your wallet is empty.</p>;
  }

  return (
    <div className="credential-grid">
      {wallet.map((cred, i) => (
        <div key={i} className="credential-card" onClick={() => onItemClick(cred)}>
          <div className="cred-icon">
            {cred.doc_type.includes('passport') ? '🛂' : 
             cred.doc_type.includes('license') ? '🪪' : 
             cred.doc_type.includes('mynumber') ? '💳' : '📄'}
          </div>
          <div className="cred-info">
            <div className="cred-name">{cred.name.replace(/\.cose$/, '').replace(/_/g, ' ')}</div>
            <div className="cred-type">{cred.doc_type}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
