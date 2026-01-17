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

  const { status, setStatus, error, setError, cardData, setCardData, readJPKI, readPassport, readDriverLicense, readResidenceCard, formatError } = useCardReader();
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

  const photo = useMemo(() => {
      if (!cardData?.face_photo && !cardData?.dg2) return null;
      const b64 = cardData.face_photo || cardData.dg2;
      const mime = cardData.face_photo_format ? `image/${cardData.face_photo_format}` : "image/jpeg";
      
      const normalize = (s: string) => {
        let b = s.replace(/-/g, "+").replace(/_/g, "/");
        const p = b.length % 4;
        if (p) b += "=".repeat(4 - p);
        return b;
      };

      const norm = normalize(b64);
      const pad = norm.endsWith("==") ? 2 : norm.endsWith("=") ? 1 : 0;
      const size = Math.max(0, Math.floor((norm.length * 3) / 4) - pad);

      return { src: `data:${mime};base64,${norm}`, size };
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
