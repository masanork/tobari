import { useMemo } from "react";

interface CardDataPreviewProps {
  cardData: any;
  cardType: string;
  onSave: () => void;
  onDismiss: () => void;
  displayPhoto: { src: string; size: number } | null;
}

export function CardDataPreview({ cardData, cardType, onSave, onDismiss, displayPhoto }: CardDataPreviewProps) {
  const isWalletItem = cardData._is_wallet_item;

  // Helper to find a value in different potential locations (Case-insensitive)
  const findValue = (keys: string[]) => {
    const lowercaseKeys = keys.map(k => k.toLowerCase().replace(/_/g, ''));
    
    const search = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return null;
      
      // Look at all keys in current object
      for (const actualKey of Object.keys(obj)) {
        const normalizedActual = actualKey.toLowerCase().replace(/_/g, '');
        if (lowercaseKeys.includes(normalizedActual)) {
          if (obj[actualKey] !== undefined && obj[actualKey] !== null && typeof obj[actualKey] !== 'object') {
             return obj[actualKey];
          }
        }
      }

      // Special containers
      const containers = [obj.decrypted_data, obj.fields, obj.data, obj.result, obj.attributes];
      for (const c of containers) {
        const res = search(c);
        if (res) return res;
      }
      return null;
    };
    return search(cardData);
  };

  // Log for developer to see the structure in console
  console.log("CardData Structure:", cardData);

  // Extract common fields for a cleaner UI
  const fields = [
    { label: "Name", value: findValue(["name", "full_name", "given_name", "family_name"]) },
    { label: "Birth Date", value: findValue(["birth_date", "birthdate"]) },
    { label: "Gender", value: findValue(["gender"]) },
    { label: "Address", value: findValue(["address"]) },
    { label: "License No", value: findValue(["license_number", "document_number"]) },
    { label: "Passport No", value: findValue(["passport_number"]) },
    { label: "My Number", value: findValue(["my_number", "personal_number"]) },
    { label: "Expiry", value: findValue(["expire_date", "expiry_date", "expiry_date"]) },
    { label: "Nationality", value: findValue(["nationality", "issuing_country"]) },
    { label: "Issue Date", value: findValue(["issue_date"]) },
  ].filter(f => !!f.value);

  // Extract and normalize photo
  const autoPhoto = useMemo(() => {
    // Helper to normalize Base64 and create Data URL
    const toDataUrl = (b64: string, format?: string) => {
      if (!b64 || typeof b64 !== 'string') return null;
      if (b64.startsWith('data:')) return b64; // Already a Data URL

      // Clean up whitespace and normalize URL-safe Base64
      let clean = b64.replace(/\s/g, '').replace(/-/g, "+").replace(/_/g, "/");
      
      // Add padding if missing
      const pad = clean.length % 4;
      if (pad) clean += "=".repeat(4 - pad);

      // Detect MIME type if not provided
      let mime = "image/jpeg";
      if (format) {
        mime = `image/${format === 'jp2' ? 'jpeg' : format}`;
      } else if (clean.startsWith("iVBOR")) {
        mime = "image/png";
      } else if (clean.startsWith("R0lG")) {
        mime = "image/gif";
      }
      
      const size = Math.round(clean.length * 0.75);
      return { src: `data:${mime};base64,${clean}`, size };
    };

    if (displayPhoto && displayPhoto.src) {
       // If displayPhoto is already normalized, use it
       return displayPhoto;
    }
    
    // Search in cardData
    const photoB64 = findValue(["face_photo", "photo", "dg2", "image"]);
    const format = findValue(["face_photo_format", "photo_format", "format"]);
    
    if (photoB64) {
      return toDataUrl(photoB64, format);
    }
    
    return null;
  }, [displayPhoto, cardData]);

  // Determine the display title (Card Type)
  const displayTitle = useMemo(() => {
    // 1. Explicit metadata in current object
    const rawType = cardData.card_type || cardData.doc_type || "";
    if (rawType && rawType.toLowerCase() !== "unknown") {
      // Prettify common technical docTypes
      if (rawType.includes("mynumber")) return "JAPANESE MY NUMBER CARD";
      if (rawType.includes("drivers_license") || rawType.includes("jpdl")) return "DRIVER'S LICENSE";
      if (rawType.includes("passport")) return "ELECTRONIC PASSPORT";
      return rawType.replace(/_/g, ' ').toUpperCase();
    }
    
    // 2. Schema-based inference using findValue (deep search)
    if (findValue(["my_number", "personal_number"])) return "JAPANESE MY NUMBER CARD";
    if (findValue(["license_number", "document_number"])) return "DRIVER'S LICENSE";
    if (findValue(["passport_number"])) return "ELECTRONIC PASSPORT";
    if (findValue(["residence_number"])) return "RESIDENCE CARD";

    // 3. Fallback to sidebar selection
    return cardType === 'wallet' ? 'IDENTITY DOCUMENT' : cardType.toUpperCase();
  }, [cardData, cardType]);

  // Determine the primary name for the subtitle
  const primaryName = useMemo(() => {
    const name = fields.find(f => f.label === "Name")?.value;
    if (name) return name;
    
    // Fallback: search for any ID-like field
    const id = findValue(["id", "credential_id", "subject", "doc_no"]);
    if (id) return `ID: ${id}`;

    return "Identity Holder";
  }, [fields, cardData]);

  return (
    <div className="card-data-preview">
      <div className="preview-header">
        {autoPhoto && (
          <div className="photo-badge">
            <img src={autoPhoto.src} alt="Face" />
            <span className="photo-size">{Math.round(autoPhoto.size / 1024)} KB</span>
          </div>
        )}
        <div className="header-info">
          <h2>{displayTitle}</h2>
          <p className="subtitle">{primaryName}</p>
        </div>
      </div>

      <div className="attributes-list">
        {fields.map((f, i) => (
          <div key={i} className="attribute-row">
            <span className="attribute-label">{f.label}</span>
            <span className="attribute-value">{f.value}</span>
          </div>
        ))}
      </div>

      <div className="metadata-section">
        {isWalletItem && cardData.created_at && (
          <div className="attribute-row mini">
            <span className="attribute-label">Added to Wallet</span>
            <span className="attribute-value">{new Date(cardData.created_at * 1000).toLocaleString()}</span>
          </div>
        )}

        {(cardData.decrypted_data || cardData) && (
          <details className="raw-data-dropdown">
            <summary>Raw JSON Data</summary>
            <pre className="raw-json">
              {JSON.stringify(cardData.decrypted_data || cardData, (k, v) => (k === 'face_photo' || k === 'dg2') ? "(binary image data)" : v, 2)}
            </pre>
          </details>
        )}
      </div>
      
      {!isWalletItem && (
        <div className="preview-actions">
          <button className="sign-btn primary" onClick={onSave}>Save to Wallet</button>
          <button className="reject-btn" onClick={onDismiss}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
