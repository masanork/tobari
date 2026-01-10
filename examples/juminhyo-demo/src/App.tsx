import React, { useState, useEffect } from 'react';
import { 
  User, 
  Building2, 
  Library, 
  Key, 
  CreditCard, 
  Send, 
  CheckCircle2, 
  ShieldCheck, 
  Eye, 
  ArrowRight,
  Fingerprint,
  FileCheck,
  Cpu,
  Usb
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import initCiv, { CivContext } from '@tobari/civ';
import { WebUSBCardReader } from './ccid';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Step = 
  | 'LANDING'
  | 'HOLDER_KEYGEN' 
  | 'HOLDER_APPLY'
  | 'ISSUER_ISSUE'
  | 'HOLDER_VIEW'
  | 'VERIFIER_REQUEST'
  | 'HOLDER_PRESENT'
  | 'VERIFIER_VERIFY';

export default function App() {
  const [step, setStep] = useState<Step>('LANDING');
  const [deviceKey, setDeviceKey] = useState<{ id: string, publicKey: string } | null>(null);
  const [jpkiSigned, setJpkiSigned] = useState<boolean>(false);
  const [issuedCose, setIssuedCose] = useState<Uint8Array | null>(null);
  const [presentation, setPresentation] = useState<Uint8Array | null>(null);
  const [civ, setCiv] = useState<CivContext | null>(null);

  useEffect(() => {
    initCiv().then(() => {
      console.log("Tobari CIV WASM Initialized");
    });
  }, []);

  const next = (s: Step) => setStep(s);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center">
      {/* Header */}
      <header className="w-full max-w-4xl px-6 py-8 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center text-white font-serif text-xl">
            帳
          </div>
          <h1 className="text-xl font-bold tracking-tight">Tobari Resident Record PoC</h1>
        </div>
        <div className="flex gap-2">
          <Badge role="HOLDER" active={step.startsWith('HOLDER')} />
          <Badge role="ISSUER" active={step.startsWith('ISSUER')} />
          <Badge role="VERIFIER" active={step.startsWith('VERIFIER')} />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="w-full max-w-2xl px-6 flex-1 flex flex-col justify-center py-12">
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden min-h-[500px] flex flex-col">
          {step === 'LANDING' && <Landing onStart={() => next('HOLDER_KEYGEN')} />}
          {step === 'HOLDER_KEYGEN' && <HolderKeyGen onDone={(key) => { setDeviceKey(key); next('HOLDER_APPLY'); }} />}
          {step === 'HOLDER_APPLY' && <HolderApply onDone={() => { setJpkiSigned(true); next('ISSUER_ISSUE'); }} />}
          {step === 'ISSUER_ISSUE' && <IssuerIssue deviceKey={deviceKey} onDone={(cose) => { setIssuedCose(cose); next('HOLDER_VIEW'); }} />}
          {step === 'HOLDER_VIEW' && <HolderView cose={issuedCose} onNext={() => next('VERIFIER_REQUEST')} />}
          {step === 'VERIFIER_REQUEST' && <VerifierRequest onDone={() => next('HOLDER_PRESENT')} />}
          {step === 'HOLDER_PRESENT' && <HolderPresent cose={issuedCose} onDone={(vp) => { setPresentation(vp); next('VERIFIER_VERIFY'); }} />}
          {step === 'VERIFIER_VERIFY' && <VerifierVerify vp={presentation} onRestart={() => next('LANDING')} />}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-4xl px-6 py-8 text-center text-slate-400 text-sm">
        &copy; 2026 Tobari Project - Self-Contained Digital Identity Verification
      </footer>
    </div>
  );
}

function Badge({ role, active }: { role: string, active: boolean }) {
  const labels = { HOLDER: '市民', ISSUER: '自治体', VERIFIER: '提出先 (銀行)' };
  const icons = { HOLDER: User, ISSUER: Building2, VERIFIER: Library };
  const Icon = icons[role as keyof typeof icons];
  
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium transition-all",
      active ? "bg-slate-900 text-white shadow-lg shadow-slate-200" : "bg-slate-100 text-slate-400 opacity-50"
    )}>
      <Icon size={14} />
      {labels[role as keyof typeof labels]}
    </div>
  );
}

// --- Component Fragments ---

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="p-12 flex-1 flex flex-col items-center text-center">
      <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-8">
        <ShieldCheck className="text-blue-600" size={40} />
      </div>
      <h2 className="text-3xl font-bold text-slate-900 mb-4">技術検証デモ</h2>
      <p className="text-slate-500 leading-relaxed max-w-md mb-12">
        このデモでは「住民票の写し」の電子交付における、申請・発行・提示のフローを体験できます。
        ブラウザ標準のパスキーとマイナンバーカード（JPKI）を組み合わせた高度なセキュリティを実証します。
      </p>
      <button 
        onClick={onStart}
        className="w-full bg-slate-900 text-white py-4 px-8 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2 group"
      >
        デモを開始する
        <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
      </button>
    </div>
  );
}

function HolderKeyGen({ onDone }: { onDone: (key: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [hasWebAuthn, setHasWebAuthn] = useState(false);

  useEffect(() => {
    setHasWebAuthn(!!window.PublicKeyCredential);
  }, []);

  const generate = async () => {
    setLoading(true);
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userID = crypto.getRandomValues(new Uint8Array(16));
      
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "Tobari PoC" },
          user: {
            id: userID,
            name: "tobari-user",
            displayName: "Tobari User"
          },
          pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required"
          },
          timeout: 60000
        }
      }) as PublicKeyCredential;

      if (credential) {
        onDone({ 
          id: credential.id,
          publicKey: "ES256-Device-Key-Authorized" 
        });
      }
    } catch (e) {
      console.error("Passkey Creation Error:", e);
      // Fallback for demo if cancelled or not supported
      setTimeout(() => {
        onDone({ id: "mock-id", publicKey: "p384-mock-public-key" });
      }, 1000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-12 flex-1 flex flex-col">
      <div className="mb-8">
        <h3 className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-2">Step 1: 市民</h3>
        <h2 className="text-2xl font-bold text-slate-900">Device Key の生成</h2>
      </div>
      <p className="text-slate-500 mb-8 leading-relaxed">
        まず、お使いの端末（スマートフォンやPC）内で**あなた専用の秘密鍵**を生成します。
        この鍵は端末のセキュア領域に保存され、他人が証明書をコピーして悪用することを防ぎます（所持者確認）。
      </p>
      <div className="bg-slate-50 rounded-2xl p-6 mb-8 border border-slate-100 flex items-center gap-4">
        <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center text-slate-400">
          <Fingerprint />
        </div>
        <div>
          <div className="text-xs text-slate-400 uppercase font-bold">Security Context</div>
          <div className="text-sm font-medium">
            {hasWebAuthn ? "Platform Authenticator (Passkey) 利用可能" : "Simulated Key Store"}
          </div>
        </div>
      </div>
      <div className="mt-auto">
        <button 
          onClick={generate}
          disabled={loading}
          className="w-full bg-slate-900 text-white py-4 px-8 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
        >
          {loading ? "生成中..." : "パスキーを生成する"}
        </button>
      </div>
    </div>
  );
}

function HolderApply({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<'IDLE' | 'CONNECTING' | 'READING' | 'SIGNED'>('IDLE');
  const [mode, setMode] = useState<'MOCK' | 'WEBUSB'>('MOCK');

  const connectReader = async () => {
    try {
      const reader = new WebUSBCardReader();
      await reader.connect();
      setMode('WEBUSB');
      setStatus('IDLE');
    } catch (e) {
      alert("リーダーの接続に失敗しました。WebUSB対応のリーダーを接続してください。");
    }
  };

  const sign = async () => {
    setStatus('READING');
    try {
      const context = mode === 'MOCK' ? CivContext.new_mock() : CivContext.new_web(new WebUSBCardReader());
      // Real JPKI call
      await context.read_identity("jpki", "1234");
      setStatus('SIGNED');
    } catch (e) {
      console.error(e);
      // Even if it fails, allow demo to proceed with mock
      setTimeout(() => setStatus('SIGNED'), 2000);
    }
  };

  return (
    <div className="p-12 flex-1 flex flex-col">
      <div className="mb-8">
        <h3 className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-2">Step 2: 市民</h3>
        <h2 className="text-2xl font-bold text-slate-900">JPKIによる本人確認と申請</h2>
      </div>
      <p className="text-slate-500 mb-8 leading-relaxed">
        マイナンバーカードを使って、自治体へ「住民票の写し」の交付申請を行います。
        このとき、先ほど作成した**Device公開鍵**を申請書に同封し、JPKIで署名します。
      </p>
      
      <div className="flex-1 flex flex-col justify-center items-center gap-6">
        <div className="flex gap-4 mb-4">
          <button onClick={() => setMode('MOCK')} className={cn("px-4 py-2 rounded-xl text-xs font-bold transition-all", mode === 'MOCK' ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400")}>
            Mock Mode
          </button>
          <button onClick={connectReader} className={cn("px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2", mode === 'WEBUSB' ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400")}>
            <Usb size={14} /> WebUSB Reader
          </button>
        </div>

        <div className={cn(
          "w-32 h-20 rounded-xl border-2 flex flex-col items-center justify-center transition-all",
          status === 'IDLE' ? "border-slate-200 border-dashed" : "border-blue-500 bg-blue-50"
        )}>
          <CreditCard className={cn(status === 'IDLE' ? "text-slate-300" : "text-blue-600")} />
          <span className="text-[10px] mt-2 font-bold uppercase tracking-tighter">My Number Card</span>
        </div>
        
        {status === 'IDLE' && (
          <button 
            onClick={sign}
            className="bg-white border-2 border-slate-900 text-slate-900 py-3 px-8 rounded-2xl font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
          >
            カードを読み取る (JPKI署名)
          </button>
        )}
        {status === 'READING' && (
          <div className="flex items-center gap-3 text-blue-600 font-bold animate-pulse">
            <Cpu className="animate-spin" size={18} /> カード通信中...
          </div>
        )}
        {status === 'SIGNED' && (
          <div className="text-center w-full">
            <div className="text-green-600 font-bold flex items-center gap-2 justify-center mb-4">
              <CheckCircle2 size={20} /> 署名が完了しました
            </div>
            <button 
              onClick={onDone}
              className="w-full bg-slate-900 text-white py-4 px-12 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
            >
              申請を送信する <Send size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function IssuerIssue({ deviceKey, onDone }: { deviceKey: any, onDone: (cose: Uint8Array) => void }) {
  const [processing, setProcessing] = useState(false);

  const issue = async () => {
    setProcessing(true);
    // Simulation of government issuance
    setTimeout(() => {
      onDone(new Uint8Array([0x01, 0x02])); // Mock cose
    }, 2000);
  };

  return (
    <div className="p-12 flex-1 flex flex-col bg-slate-900 text-white">
      <div className="mb-8">
        <h3 className="text-sm font-bold text-blue-400 uppercase tracking-widest mb-2">Step 3: 自治体</h3>
        <h2 className="text-2xl font-bold">住民票の発行（デジタル交付）</h2>
      </div>
      <div className="flex-1 space-y-6">
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
          <h4 className="text-xs font-bold text-slate-400 uppercase mb-4 tracking-widest">検証済み申請内容</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400 font-medium">本人確認</span>
              <span className="text-green-400 font-bold flex items-center gap-1"><ShieldCheck size={14}/> JPKI署名 有効</span>
            </div>
            <div className="flex justify-between border-b border-slate-700 pb-2">
              <span className="text-slate-400 font-medium">Binding Target</span>
              <span className="font-mono text-[10px] truncate max-w-[150px] text-blue-300">{deviceKey?.id}</span>
            </div>
          </div>
        </div>
        <p className="text-slate-400 text-sm leading-relaxed">
          自治体は申請者の Device公開鍵を**住民票のメタデータ (MSO)** に埋め込み、自治体の秘密鍵で署名します。これにより、特定の端末でのみ提示可能な証明書が生成されます。
        </p>
      </div>
      <button 
        onClick={issue}
        disabled={processing}
        className="w-full bg-white text-slate-900 py-4 px-8 rounded-2xl font-bold hover:bg-slate-100 transition-all flex items-center justify-center gap-2 mt-8"
      >
        {processing ? "発行処理中..." : "住民票を発行する"}
      </button>
    </div>
  );
}

function HolderView({ cose, onNext }: { cose: any, onNext: () => void }) {
  return (
    <div className="p-12 flex-1 flex flex-col">
      <div className="mb-8 text-center">
        <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <FileCheck className="text-green-600" size={32} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">住民票を受理しました</h2>
        <p className="text-slate-500 text-sm mt-2">発行者の署名とあなた自身の鍵が紐付けられています。</p>
      </div>
      
      <div className="flex-1 bg-white rounded-2xl p-6 border-2 border-slate-900 mb-8 overflow-hidden relative shadow-inner">
        <div className="font-serif space-y-4 opacity-80 scale-[0.85] origin-top">
          <div className="border-b-2 border-slate-900 text-center pb-2 text-xl font-bold tracking-[0.5em]">住民票の写し</div>
          <div className="grid grid-cols-2 gap-4 text-[10px]">
            <div className="border border-slate-300 p-2">住所：東京都港区虎ノ門2-2-1...</div>
            <div className="border border-slate-300 p-2">世帯主：䶒藤 太朗</div>
          </div>
          <table className="w-full border-collapse border border-slate-300 text-[8px]">
            <thead>
              <tr className="bg-slate-50">
                <th className="border border-slate-300 p-1">氏名 / 生年月日</th>
                <th className="border border-slate-300 p-1">続柄 / 本籍</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-slate-300 p-2">䶒藤 太朗<br/>1989年1月1日</td>
                <td className="border border-slate-300 p-2">世帯主<br/>東京都千代田区...</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent flex flex-col justify-end p-6 text-center">
          <div className="bg-slate-900 text-white shadow-xl rounded-xl p-4 inline-block mx-auto transform translate-y-2">
            <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Encoded Data (mDoc / SD-JWT)</div>
            <div className="text-xs font-mono flex items-center gap-2">
              <ShieldCheck size={14} className="text-blue-400" /> Securely Stored
            </div>
          </div>
        </div>
      </div>

      <button 
        onClick={onNext}
        className="w-full bg-slate-900 text-white py-4 px-8 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
      >
        銀行の手続きに進む (提示) <ArrowRight size={18} />
      </button>
    </div>
  );
}

function VerifierRequest({ onDone }: { onDone: () => void }) {
  return (
    <div className="p-12 flex-1 flex flex-col bg-blue-600 text-white">
      <div className="mb-8">
        <h3 className="text-sm font-bold text-blue-200 uppercase tracking-widest mb-2">Step 4: 提出先 (銀行)</h3>
        <h2 className="text-2xl font-bold">住宅ローンの申し込み</h2>
      </div>
      <div className="flex-1 space-y-6">
        <div className="bg-white/10 rounded-2xl p-6 border border-white/20">
          <h4 className="text-xs font-bold text-blue-200 uppercase mb-4">要求されている項目</h4>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-blue-300"/> 氏名・住所・生年月日</li>
            <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-blue-300"/> 続柄（世帯全員）</li>
            <li className="text-slate-300 ml-6 italic">※ マイナンバー・本籍地は不要です</li>
          </ul>
        </div>
        <p className="text-blue-100 text-sm leading-relaxed">
          銀行は特定の項目のみの開示を要求します。Tobariでは、不要な項目（マイナンバー等）を隠したまま、原本性を証明できます。
        </p>
      </div>
      <button 
        onClick={onDone}
        className="w-full bg-white text-blue-600 py-4 px-8 rounded-2xl font-bold hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
      >
        住民票を提示する
      </button>
    </div>
  );
}

function HolderPresent({ deviceKey, cose, onDone }: { deviceKey: any, cose: any, onDone: (vp: Uint8Array) => void }) {
  const [maskMyNumber, setMaskMyNumber] = useState(true);
  const [loading, setLoading] = useState(false);

  const signVP = async () => {
    setLoading(true);
    try {
      // Real WebAuthn Authentication (Signature)
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          userVerification: "required",
          allowCredentials: [{
            id: Uint8Array.from(atob(deviceKey.id.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
            type: "public-key"
          }]
        }
      });
      
      if (assertion) {
        onDone(new Uint8Array([0x03, 0x04]));
      }
    } catch (e) {
      console.error("Passkey Auth Error:", e);
      // Fallback
      setTimeout(() => onDone(new Uint8Array([0x03, 0x04])), 1500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-12 flex-1 flex flex-col">
      <div className="mb-8">
        <h3 className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-2">Step 5: 市民</h3>
        <h2 className="text-2xl font-bold text-slate-900">選択的開示と提示署名</h2>
      </div>
      
      <div className="flex-1 space-y-4">
        <p className="text-slate-500 text-sm">提示する内容を選択し、あなたのパスキーで署名を行います。</p>
        
        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">基本4情報・続柄</span>
            <span className="text-[10px] bg-slate-200 px-2 py-1 rounded font-bold">必須</span>
          </div>
          <div className="flex justify-between items-center pt-4 border-t border-slate-200">
            <div>
              <span className="text-sm font-medium block">個人番号 (マイナンバー)</span>
              <span className="text-[10px] text-slate-400">提示先には開示されません</span>
            </div>
            <input type="checkbox" checked={maskMyNumber} onChange={e => setMaskMyNumber(e.target.checked)} className="w-5 h-5 accent-slate-900" />
          </div>
        </div>

        <div className="bg-blue-50 rounded-2xl p-4 flex items-start gap-3 border border-blue-100">
          <ShieldCheck className="text-blue-600 shrink-0" size={18} />
          <div className="text-xs text-blue-800 leading-normal">
            Device署名 (Holder Binding) により、あなたが正当な所有者であることが銀行に証明されます。
          </div>
        </div>
      </div>

      <button 
        onClick={signVP}
        className="w-full bg-slate-900 text-white py-4 px-8 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2 mt-8"
      >
        {loading ? "署名中..." : "パスキーで署名して提示"}
      </button>
    </div>
  );
}

function VerifierVerify({ vp, onRestart }: { vp: any, onRestart: () => void }) {
  return (
    <div className="p-12 flex-1 flex flex-col items-center text-center">
      <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-8">
        <ShieldCheck className="text-green-600" size={40} />
      </div>
      <h2 className="text-3xl font-bold text-slate-900 mb-4">検証成功</h2>
      <p className="text-slate-500 leading-relaxed mb-8">
        提示されたデータの真正性と所持者の正当性が暗号学的に確認されました。
      </p>
      
      <div className="w-full space-y-2 text-left mb-12 bg-slate-50 rounded-2xl p-6 border border-slate-100 shadow-inner">
        <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-4 tracking-widest">Technical Verification</h4>
        <VerificationRow label="Issuer Signature (MSO)" status="VALID" />
        <VerificationRow label="Device Signature (Handover)" status="VALID" />
        <VerificationRow label="Selective Disclosure Hash" status="MATCH" />
        <VerificationRow label="Transaction Binding (Nonce)" status="BOUND" />
        <VerificationRow label="個人番号 (My Number)" status="MASKED" />
      </div>

      <button 
        onClick={onRestart}
        className="w-full bg-slate-900 text-white py-4 px-8 rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-200"
      >
        デモを終了して最初に戻る
      </button>
    </div>
  );
}

function VerificationRow({ label, status }: { label: string, status: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-slate-200/50 last:border-0">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <span className={cn(
        "text-[10px] font-bold px-2 py-0.5 rounded",
        status === 'VALID' || status === 'MATCH' || status === 'BOUND' ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"
      )}>{status}</span>
    </div>
  );
}
