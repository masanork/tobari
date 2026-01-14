import type { Layer2Encrypted } from "./l2crypto";

export type DraftState = {
  version: number;
  savedAt: string;
  formId: string;
  formData: unknown;
  l2State?: {
    replayNonces?: string[];
  };
};

export type DownloadHtmlOptions = {
  embeddedVc?: any;
  l2Envelope?: Layer2Encrypted;
  stripPlaintext?: boolean;
  draftState?: DraftState;
};

function stripPlaintext(doc: Document) {
  // Save json-debug content before stripping (it contains the baked data)
  const debug = doc.getElementById("json-debug");
  const savedDebugContent = debug?.textContent || "";

  doc.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
    if (input.type === "checkbox" || input.type === "radio") {
      input.checked = false;
      input.removeAttribute("checked");
    } else {
      input.value = "";
      input.removeAttribute("value");
    }
  });
  doc.querySelectorAll<HTMLTextAreaElement>("textarea").forEach((area) => {
    area.value = "";
    area.textContent = "";
  });
  doc.querySelectorAll<HTMLSelectElement>("select").forEach((select) => {
    select.selectedIndex = -1;
    select.querySelectorAll("option").forEach((opt) => opt.removeAttribute("selected"));
  });
  doc.getElementById("json-ld")?.remove();
  doc.getElementById("data-layer")?.remove();

  // Restore json-debug with the baked data (don't clear it!)
  if (debug && savedDebugContent) {
    debug.textContent = savedDebugContent;
  }
}

function embedVc(doc: Document, vc: any) {
  const vcJson = JSON.stringify(vc, null, 2);
  const vcScript = doc.createElement("script");
  vcScript.type = "application/ld+json";
  vcScript.id = "weba-user-vc";
  vcScript.textContent = vcJson;
  doc.body.appendChild(vcScript);

  const vcViewer = doc.createElement("div");
  vcViewer.className = "weba-user-verification no-print";
  vcViewer.style.cssText =
    "margin-top:2rem;padding:1rem;border:1px solid #10b981;border-radius:8px;background:#f0fdf4;font-size:0.85rem;";
  vcViewer.innerHTML = `
    <details>
      <summary style="cursor: pointer; display: flex; align-items: center; gap: 0.5rem; color: #047857; font-weight: 600;">
        <span>✓</span> 利用者による署名の証明
      </summary>
      <div style="padding: 1rem 0;">
        <pre style="background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; line-height: 1.4;"></pre>
      </div>
    </details>
  `;
  const pre = vcViewer.querySelector("pre");
  if (pre) pre.textContent = vcJson;
  doc.body.appendChild(vcViewer);
}

function embedL2Envelope(doc: Document, envelope: Layer2Encrypted) {
  const envScript = doc.createElement("script");
  envScript.id = "weba-l2-envelope";
  envScript.type = "application/json";
  envScript.textContent = JSON.stringify(envelope, null, 2);
  doc.body.appendChild(envScript);
}

function embedDraftState(doc: Document, draftState: DraftState) {
  const existing = doc.getElementById("weba-draft-state");
  if (existing) existing.remove();
  const draftScript = doc.createElement("script");
  draftScript.id = "weba-draft-state";
  draftScript.type = "application/json";
  draftScript.textContent = JSON.stringify(draftState, null, 2);
  doc.body.appendChild(draftScript);
}

function buildFilename(title: string, filenameSuffix: string): string {
  const now = new Date();
  const dateStr =
    now.getFullYear() +
    ("0" + (now.getMonth() + 1)).slice(-2) +
    ("0" + now.getDate()).slice(-2) +
    "-" +
    ("0" + now.getHours()).slice(-2) +
    ("0" + now.getMinutes()).slice(-2);
  const randomId = Math.random().toString(36).substring(2, 8);
  return `${title}_${dateStr}_${filenameSuffix}_${randomId}.html`;
}

function markAsSubmitted(doc: Document) {
  // Add submitted marker with L3 metadata
  const submittedMarker = doc.createElement("script");
  submittedMarker.id = "weba-submitted";
  submittedMarker.type = "application/json";
  const confirmedAt = new Date().toISOString();
  submittedMarker.textContent = JSON.stringify({
    submitted: true,
    submittedAt: confirmedAt, // Legacy field
    confirmedAt: confirmedAt,
    l3Metadata: {
      events: [
        {
          type: 'Confirm',
          timestamp: confirmedAt,
          payload: {}
        }
      ]
    }
  }, null, 2);
  doc.body.appendChild(submittedMarker);
}

export function buildDownloadHtml(documentHtml: string, isFinal: boolean, options?: DownloadHtmlOptions): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(documentHtml, "text/html");
  if (options?.stripPlaintext) {
    stripPlaintext(doc);
  }
  if (options?.embeddedVc) {
    embedVc(doc, options.embeddedVc);
  }
  if (options?.l2Envelope) {
    embedL2Envelope(doc, options.l2Envelope);
  }
  if (options?.draftState) {
    embedDraftState(doc, options.draftState);
  }
  if (isFinal) {
    markAsSubmitted(doc);
  }
  return doc.documentElement.outerHTML;
}

export function downloadHtml(params: {
  documentHtml: string;
  title: string;
  filenameSuffix: string;
  isFinal: boolean;
  options?: DownloadHtmlOptions;
}) {
  const htmlContent = buildDownloadHtml(params.documentHtml, params.isFinal, params.options);
  const blob = new Blob([htmlContent], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildFilename(params.title, params.filenameSuffix);
  a.click();
  if (params.isFinal) {
    setTimeout(() => window.location.reload(), 1000);
  }
}
