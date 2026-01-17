import { useState, useEffect, useMemo } from "react";
import init from "@tobari/civ";
import { useWallet } from "./useWallet";
import { useCardReader } from "./useCardReader";
import { usePasskeyState } from "./usePasskeyState";
import { usePendingRequest } from "./usePendingRequest";
import { Sidebar } from "./Sidebar";
import { CardDataPreview } from "./CardDataPreview";
import { SignRequestView } from "./SignRequestView";
import "./App.css";

function App() {
  const [cardType, setCardType] = useState<string>("wallet");
  const [pin, setPin] = useState<string>("");
  const [pin2, setPin2] = useState<string>("");
  const [mrz, setMrz] = useState<string>("");

  const { status, setStatus, error, setError, cardData, setCardData, readJPKI, readPassport, readDriverLicense, readResidenceCard, detectCardType, formatError } = useCardReader();
  const { wallet, inspectItem, saveToWallet } = useWallet();
  const { usePasskey, setUsePasskey, passkeyId, registerPasskey } = usePasskeyState();
  const { request, handleSign, handleJpkiSign, handleBbsProof, handleReject, handleRegister } = usePendingRequest(setStatus, setError, formatError);

  useEffect(() => {
    init().catch(console.error);
  }, []);

  const onSaveToWallet = async () => {
    if (!cardData) return;
    try {
      await saveToWallet(cardData, cardType, usePasskey, passkeyId);
      setStatus("Saved to Wallet!");
      setCardData(null);
      setCardType('wallet');
    } catch (e: any) {
      setError("Failed to save: " + e.toString());
    }
  };

  const handleDetection = async () => {
      const type = await detectCardType();
      if (type && type !== "unknown") {
          setCardType(type);
      } else {
          setError("No known card detected. Please place card on reader.");
      }
  };

  const photo = useMemo(() => {
      // Helper to get photo data from different structures
      const getPhotoData = () => {
        // Direct access (from card reader)
        if (cardData?.face_photo) return { data: cardData.face_photo, format: cardData.face_photo_format };
        if (cardData?.dg2) return { data: cardData.dg2, format: cardData.face_photo_format };

        // Wallet item structure (decrypted_data.data.*)
        const decrypted = cardData?.decrypted_data?.data;
        if (decrypted?.face_photo) return { data: decrypted.face_photo, format: decrypted.face_photo_format };
        if (decrypted?.dg2) return { data: decrypted.dg2, format: decrypted.face_photo_format };

        return null;
      };

      const photoInfo = getPhotoData();
      if (!photoInfo) return null;

      const { data, format } = photoInfo;
      const mime = format ? `image/${format === 'jpg' ? 'jpeg' : format}` : "image/jpeg";

      // Handle binary data (Uint8Array or array of numbers from CBOR decode)
      const isBinary = data instanceof Uint8Array ||
                       (Array.isArray(data) && data.length > 0 && typeof data[0] === 'number');

      if (isBinary) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const blob = new Blob([bytes], { type: mime });
        return { src: URL.createObjectURL(blob), size: bytes.length };
      }

      // Handle Base64 string (from card reader)
      if (typeof data === 'string') {
        const normalize = (s: string) => {
          let b = s.replace(/-/g, "+").replace(/_/g, "/");
          const p = b.length % 4;
          if (p) b += "=".repeat(4 - p);
          return b;
        };

        const norm = normalize(data);
        const pad = norm.endsWith("==") ? 2 : norm.endsWith("=") ? 1 : 0;
        const size = Math.max(0, Math.floor((norm.length * 3) / 4) - pad);

        return { src: `data:${mime};base64,${norm}`, size };
      }

      return null;
  }, [cardData]);

  return (
    <div className="app-layout">
      <Sidebar
        cardType={cardType} setCardType={setCardType}
        usePasskey={usePasskey} setUsePasskey={setUsePasskey}
        passkeyId={passkeyId} onRegisterPasskey={() => registerPasskey(setStatus, setError)}
        wallet={wallet} onWalletItemClick={async (c) => setCardData(await inspectItem(c))}
        pin={pin} setPin={setPin}
        pin2={pin2} setPin2={setPin2}
        mrz={mrz} setMrz={setMrz}
        onReadJPKI={() => readJPKI(pin)}
        onReadPassport={() => readPassport(mrz)}
        onReadLicense={() => readDriverLicense(pin, pin2)}
        onReadResidence={readResidenceCard}
        onDetectCard={handleDetection}
        status={status} onReject={handleReject}
        hasRequest={!!request} hasError={!!error}
      />

      <section className="content-area">
        {error && <div className="error-container"><p className="error-text">{error}</p></div>}

        {cardData ? (
          <CardDataPreview
            cardData={cardData}
            cardType={cardType}
            onSave={onSaveToWallet}
            onDismiss={() => setCardData(null)}
            displayPhoto={photo}
          />
        ) : request ? (
          <SignRequestView
            request={request}
            onSign={handleSign}
            onRegister={handleRegister}
            onJpkiSign={() => handleJpkiSign(pin)}
            onBbsProof={handleBbsProof}
            onReject={handleReject}
            status={status}
          />
        ) : (
          <div className="placeholder-state">
            <div className="placeholder-icon">👋</div>
            <p>Select an action from the sidebar or wait for a service request.</p>
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
