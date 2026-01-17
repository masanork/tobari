interface CardDataPreviewProps {
  cardData: any;
  cardType: string;
  onSave: () => void;
  onDismiss: () => void;
  displayPhoto: { src: string; size: number } | null;
}

export function CardDataPreview({ cardData, cardType, onSave, onDismiss, displayPhoto }: CardDataPreviewProps) {
  const isWalletItem = cardData._is_wallet_item;

  return (
    <div className="card-data-preview">
      <h3>Information from {isWalletItem ? "Wallet" : cardType.toUpperCase()}</h3>
      <div className="preview-grid">
        {cardData.name && <div className="preview-item"><strong>Name:</strong> {cardData.name}</div>}
        {cardData.address && <div className="preview-item"><strong>Address:</strong> {cardData.address}</div>}
        {cardData.birth_date && <div className="preview-item"><strong>Birth Date:</strong> {cardData.birth_date}</div>}
        {cardData.license_number && <div className="preview-item"><strong>License No:</strong> {cardData.license_number}</div>}
        {cardData.passport_number && <div className="preview-item"><strong>Passport No:</strong> {cardData.passport_number}</div>}
        
        {cardData.decrypted_data && (
          <div className="preview-full">
            <strong>Decrypted Data:</strong>
            <pre className="raw-json">{JSON.stringify(cardData.decrypted_data, null, 2)}</pre>
          </div>
        )}

        {isWalletItem && (
           <>
             <div className="preview-item"><strong>Type:</strong> {cardData.doc_type}</div>
             {cardData.created_at && (
               <div className="preview-item"><strong>Added:</strong> {new Date(cardData.created_at * 1000).toLocaleString()}</div>
             )}
             <div className="preview-full">
                <strong>Storage Path:</strong>
                <code style={{fontSize: '0.8em', opacity: 0.7}}>{cardData.path}</code>
             </div>
           </>
        )}
      </div>
      
      {displayPhoto && (
        <div className="photo-container">
          <p style={{fontSize: '0.7em', color: '#888'}}>Photo ({displayPhoto.size} bytes)</p>
          <img src={displayPhoto.src} alt="Face" style={{width: 150, borderRadius: 8}} />
        </div>
      )}
      
      {!isWalletItem && (
        <div style={{marginTop: '1.5rem', display: 'flex', gap: '0.5rem'}}>
          <button className="sign-btn primary" onClick={onSave}>Save to Wallet</button>
          <button className="reject-btn" onClick={onDismiss}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
