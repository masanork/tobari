import { useState, useEffect } from 'react';
import init, { CivContext } from '@tobari/civ';

function App() {
  const [civ, setCiv] = useState<CivContext | null>(null);
  const [status, setStatus] = useState("Initializing WASM...");
  const [cardType, setCardType] = useState("jpki");
  const [pin, setPin] = useState("1234");
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    init().then(() => {
      setStatus("WASM Loaded. Ready.");
      // Initialize with Mock for demo
      const context = CivContext.new_mock();
      setCiv(context);
    }).catch(e => {
      setStatus(`Error loading WASM: ${e}`);
    });
  }, []);

  const handleRead = async () => {
    if (!civ) return;
    setStatus("Reading...");
    setResult(null);
    try {
      // Mock PIN handling
      const identity = await civ.read_identity(cardType, pin);
      setResult(identity);
      setStatus("Success!");
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e}`);
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h1>CIV Web Demo (Mock Mode)</h1>
      <p>Status: {status}</p>
      
      <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
        <div style={{ marginBottom: '10px' }}>
          <label>Card Type: </label>
          <select value={cardType} onChange={e => setCardType(e.target.value)}>
            <option value="jpki">My Number Card (JPKI)</option>
            <option value="dl">Drivers License (JPDL)</option>
            <option value="rc">Residence Card (JPRC)</option>
            <option value="passport">Passport (ICAO)</option>
            <option value="piv">PIV Card</option>
          </select>
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label>PIN / MRZ: </label>
          <input 
            type="text" 
            value={pin} 
            onChange={e => setPin(e.target.value)} 
            placeholder="1234 or 123456"
          />
        </div>

        <button onClick={handleRead} disabled={!civ}>Read Identity</button>
      </div>

      {result && (
        <div style={{ background: '#f5f5f5', padding: '15px', borderRadius: '8px', overflowX: 'auto' }}>
          <h3>Result</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default App;
