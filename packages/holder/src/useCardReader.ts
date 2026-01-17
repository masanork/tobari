import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useCardReader() {
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [cardData, setCardData] = useState<any | null>(null);

  const formatError = useCallback((e: any): string => {
    if (typeof e === 'string') return e;
    if (e.type === "IncorrectPin") {
      return `Incorrect PIN. ${e.details.retries} attempts remaining.`;
    }
    if (e.type === "PinLocked") {
      return "The PIN is locked. You must visit your local municipal office to reset it.";
    }
    return JSON.stringify(e);
  }, []);

  const readJPKI = async (pin: string) => {
    if (!pin) {
      setError("Please enter your 4-digit PIN.");
      return;
    }
    setStatus("Reading My Number Card...");
    setError(null);
    try {
      const data = await invoke<any>("read_my_number_card", { request: { pin } });
      const enrichedData = { ...data, card_type: "Japanese My Number Card" };
      setCardData(enrichedData);
      setStatus("Card read successfully!");
      return enrichedData;
    } catch (e: any) {
      setError("Failed to read card: " + formatError(e));
      setStatus("Error");
    }
  };

  const readPassport = async (mrz: string) => {
    if (mrz.length < 20) {
      setError("Please enter a valid MRZ.");
      return;
    }
    setStatus("Reading Passport...");
    setError(null);
    try {
      const data = await invoke<any>("read_passport", { request: { mrz } });
      const enrichedData = { ...data, card_type: "Electronic Passport" };
      setCardData(enrichedData);
      setStatus("Passport read successfully!");
      return enrichedData;
    } catch (e: any) {
      setError("Failed to read passport: " + formatError(e));
      setStatus("Error");
    }
  };

  const readDriverLicense = async (pin1: string, pin2: string) => {
    if (!pin1 || !pin2) {
      setError("Please enter both PIN1 and PIN2.");
      return;
    }
    setStatus("Reading Driver License...");
    setError(null);
    try {
      const data = await invoke<any>("read_driver_license", { request: { pin1, pin2 } });
      const enrichedData = { ...data, card_type: "Driver's License" };
      setCardData(enrichedData);
      setStatus("Driver License read successfully!");
      return enrichedData;
    } catch (e: any) {
      setError("Failed to read driver license: " + formatError(e));
      setStatus("Error");
    }
  };

  const readResidenceCard = async () => {
    setStatus("Reading Residence Card...");
    setError(null);
    try {
      const data = await invoke<any>("read_residence_card");
      const enrichedData = { ...data, card_type: "Residence Card" };
      setCardData(enrichedData);
      setStatus("Residence Card read successfully!");
      return enrichedData;
    } catch (e: any) {
      setError("Failed to read residence card: " + formatError(e));
      setStatus("Error");
    }
  };

  const clearCardData = () => setCardData(null);

  const detectCardType = async () => {
    setStatus("Detecting card type...");
    setError(null);
    try {
      const type = await invoke<string>("detect_card_type");
      setStatus(`Detected: ${type}`);
      return type;
    } catch (e: any) {
      setError("Detection failed: " + formatError(e));
      setStatus("Error");
      return "unknown";
    }
  };

  return { 
    status, 
    setStatus, 
    error, 
    setError, 
    cardData, 
    setCardData, 
    readJPKI, 
    readPassport, 
    readDriverLicense, 
    readResidenceCard,
    detectCardType,
    clearCardData,
    formatError
  };
}
