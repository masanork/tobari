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

  // Determine the search root - prioritize decrypted data for attribute extraction
  const searchRoot = useMemo(() => {
    if (cardData.decrypted_data) {
       return cardData.decrypted_data.data || cardData.decrypted_data;
    }
    return cardData.data || cardData;
  }, [cardData]);

  // Helper to find a value in different potential locations (Deep Case-insensitive Search)
  const findValue = (keys: string[]) => {
    const targetKeys = keys.map(k => k.toLowerCase().replace(/_/g, ''));
    const visited = new Set(); // Avoid circular references
    
    const search = (obj: any): any => {
      if (!obj || typeof obj !== 'object' || visited.has(obj)) return null;
      visited.add(obj);
      
      // 1. Immediate match in this object
      for (const actualKey of Object.keys(obj)) {
        const normalizedActual = actualKey.toLowerCase().replace(/_/g, '');
        if (targetKeys.includes(normalizedActual)) {
          const val = obj[actualKey];
          if (val !== undefined && val !== null) {
             const isBinaryArray = Array.isArray(val) && val.length > 0 && typeof val[0] === 'number';
             if (
               typeof val !== 'object' ||
               val instanceof Uint8Array ||
               val instanceof ArrayBuffer ||
               isBinaryArray ||
               (val && (val.type === 'Buffer' || Array.isArray(val.data)))
             ) {
               return val;
             }
          }
        }
      }

      // 2. Deep recursive search through all properties
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val && typeof val === 'object' && !(val instanceof Uint8Array)) {
          const res = search(val);
          if (res) return res;
        }
      }
      return null;
    };
    return search(searchRoot);
  };

  // Log for developer to see the structure in console
  console.log("CardData Structure:", cardData, "Search Root:", searchRoot);

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
    // Helper to normalize data into a displayable URL
    const toPhotoSource = (data: any, format?: string) => {
      if (!data) return null;
      
      // Case 1: Already a Data URL string
      if (typeof data === 'string' && data.startsWith('data:')) {
        return { src: data, size: Math.round(data.length * 0.75) };
      }

      // Case 2: Binary data (Uint8Array, ArrayBuffer, or Buffer-like object)
      const isBinary = data instanceof Uint8Array || 
                       data instanceof ArrayBuffer || 
                       (data && (data.type === 'Buffer' || Array.isArray(data.data) || (data._isBuffer))) ||
                       (Array.isArray(data) && data.length > 100 && typeof data[0] === 'number'); // Handle raw byte array
      
      if (isBinary) {
        let bytes: Uint8Array;
        if (data instanceof Uint8Array) bytes = data;
        else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
        else if (Array.isArray(data.data)) bytes = new Uint8Array(data.data);
        else if (Array.isArray(data)) bytes = new Uint8Array(data);
        else bytes = new Uint8Array(data);
        
        console.log("Processing binary photo data, size:", bytes.length);
        const blob = new Blob([bytes], { type: format === 'jp2' ? 'image/jp2' : 'image/jpeg' });
        return { src: URL.createObjectURL(blob), size: bytes.length, isBlob: true };
      }

      // Case 3: Base64 string
      if (typeof data === 'string') {
        const clean = data.replace(/\s/g, '').replace(/-/g, "+").replace(/_/g, "/");
        const normalizedFormat = format?.toLowerCase() === 'jpg' ? 'jpeg' : format?.toLowerCase();
        const detectMime = (b64: string) => {
          try {
            const head = b64.slice(0, 64);
            const padLen = (4 - (head.length % 4)) % 4;
            const padded = head + "=".repeat(padLen);
            const bin = atob(padded);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
            if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
            if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
            if (bytes.length >= 8 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x0C && bytes[4] === 0x6A && bytes[5] === 0x50 && bytes[6] === 0x20 && bytes[7] === 0x20) return 'image/jp2';
            if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0x4F) return 'image/jp2';
          } catch {
            return null;
          }
          return null;
        };
        const detected = detectMime(clean);
        const mime = detected || (normalizedFormat ? `image/${normalizedFormat}` : (clean.startsWith("iVBOR") ? 'image/png' : 'image/jpeg'));
        const pad = clean.length % 4;
        const padded = pad ? clean + "=".repeat(4 - pad) : clean;
        return { src: `data:${mime};base64,${padded}`, size: Math.round(padded.length * 0.75) };
      }

      return null;
    };

    if (displayPhoto && displayPhoto.src) return displayPhoto;
    
    // 1. Direct priority check for known photo keys at common locations
    const photoData = findValue(["face_photo", "photo", "dg2", "facephoto", "face_image", "image"]);
    const rawFormat = findValue(["face_photo_format", "photo_format", "format"]);
    const normalizedFormat = typeof rawFormat === 'string' ? rawFormat.trim().toLowerCase() : undefined;
    const format = normalizedFormat && ['jpeg', 'jpg', 'png', 'jp2'].includes(normalizedFormat)
      ? (normalizedFormat === 'jpg' ? 'jpeg' : normalizedFormat)
      : undefined;
    
    // Additional check: Sometimes cardData itself IS the decrypted data, or it's wrapped in 'data'
    const directPhoto = cardData.face_photo || cardData.dg2 || (cardData.data && (cardData.data.face_photo || cardData.data.dg2));
    
    if (photoData || directPhoto) {
      const result = toPhotoSource(photoData || directPhoto, format);
      if (result) console.log("Photo source resolved successfully.");
      return result;
    }
    
    return null;
  }, [displayPhoto, cardData]);

  // Determine the display title (Card Type)
  const displayTitle = useMemo(() => {
    const rawType = (cardData.card_type || cardData.doc_type || "").toLowerCase();
    if (rawType && rawType !== "unknown") {
      if (rawType.includes("mynumber")) return "JAPANESE MY NUMBER CARD";
      if (rawType.includes("drivers_license") || rawType.includes("jpdl")) return "DRIVER'S LICENSE";
      if (rawType.includes("passport") || rawType.includes("dtc")) return "ELECTRONIC PASSPORT";
      return rawType.replace(/_/g, ' ').toUpperCase();
    }
    
    if (findValue(["my_number", "personal_number"])) return "JAPANESE MY NUMBER CARD";
    if (findValue(["license_number", "document_number"])) return "DRIVER'S LICENSE";
    if (findValue(["passport_number"])) return "ELECTRONIC PASSPORT";
    if (findValue(["residence_number"])) return "RESIDENCE CARD";

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
              {JSON.stringify(cardData.decrypted_data || cardData, (k, v) => {
                if (v instanceof Uint8Array || v instanceof ArrayBuffer || (v && (v.type === 'Buffer' || Array.isArray(v.data)))) {
                  const size = v.length || v.byteLength || (v.data && v.data.length) || 0;
                  return `[Binary Data: ${size} bytes, Key: ${k}]`;
                }
                return v;
              }, 2)}
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
