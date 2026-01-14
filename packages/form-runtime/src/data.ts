
import { globalSigner } from './signer';
import { downloadHtml, type DownloadHtmlOptions, type DraftState } from './download';
import type { L2Config, Layer2Encrypted, L2Keywrap } from './l2crypto';
import { ValidationDialog, checkRequiredFields } from './validation-dialog';

export class DataManager {
    private formId: string;
    private static readonly DRAFT_STATE_VERSION = 1;
    private static readonly L2_REPLAY_STORE_KEY = "weba_l2_nonces";
    private currentSecurityTier: 'high' | 'standard' | 'offline' = 'standard';
    private validationDialog: ValidationDialog;

    constructor() {
        this.formId = 'WebA_' + window.location.pathname;
        this.validationDialog = new ValidationDialog();
    }

    private updateSecurityUI(tier: 'high' | 'standard' | 'offline') {
        this.currentSecurityTier = tier;
        const event = new CustomEvent('weba-security-tier-change', { detail: { tier } });
        window.dispatchEvent(event);
    }

    public updateJsonLd(): any {
        const data: any = {};

        // 1. Static Fields
        document.querySelectorAll('[data-json-path]').forEach((input: any) => {
            const key = input.dataset.jsonPath;
            if (key) {
                // 電話番号フィールドは数字のみを保存
                if (input.type === 'tel') {
                    data[key] = input.value.replace(/[^0-9]/g, '');
                } else {
                    data[key] = input.value;
                }
            }
        });

        // 2. Radio Groups
        document.querySelectorAll('[type="radio"]:checked').forEach((radio: any) => {
            data[radio.name] = radio.value;
        });

        // 3. Dynamic Tables
        document.querySelectorAll('table.data-table.dynamic').forEach((table: any) => {
            const tableKey = table.dataset.tableKey;
            if (tableKey) {
                const rows: any[] = [];
                table.querySelectorAll('tbody tr').forEach((tr: any) => {
                    // Collect row data
                    const rowData: any = {};
                    let hasVal = false;
                    tr.querySelectorAll('[data-base-key]').forEach((input: any) => {
                        if (input.type === 'checkbox') {
                            rowData[input.dataset.baseKey] = input.checked;
                            if (input.checked) hasVal = true;
                        } else {
                            rowData[input.dataset.baseKey] = input.value;
                            if (input.value) hasVal = true;
                        }
                    });
                    if (hasVal) rows.push(rowData);
                });
                data[tableKey] = rows;
            }
        });

        const scriptBlock = document.getElementById('json-ld');
        if (scriptBlock) {
            scriptBlock.textContent = JSON.stringify(data, null, 2);
        }
        const debugBlock = document.getElementById('json-debug');
        if (debugBlock) {
            debugBlock.textContent = JSON.stringify(data, null, 2);
        }
        return data;
    }

    private getL2Config(): L2Config | null {
        const w = window as any;
        return w.webaL2Config || null;
    }

    public async signAndDownload() {
        // CHECK VALIDATION FIRST
        const validationResult = checkRequiredFields();

        if (!validationResult.isValid) {
            // Show confirmation dialog
            this.validationDialog.show({
                missingFields: validationResult.missingFields,
                onCancel: () => {
                    console.log('[DataManager] User cancelled submission');
                    // Return to form - nothing to do
                },
                onSubmit: () => {
                    console.log('[DataManager] User confirmed submission despite missing fields');
                    // Proceed with actual submission
                    this.performSignAndDownload();
                }
            });
            return; // Stop here - let dialog handle next steps
        }

        // If valid, proceed directly
        await this.performSignAndDownload();
    }

    private async performSignAndDownload() {
        const data = this.updateJsonLd();
        const w = window as any;
        const formName = (w.generatedJsonStructure && w.generatedJsonStructure.name) || 'Response';

        // Try to get template ID from document or use URL
        const templateId = window.location.href.split('#')[0];

        const l2Config = this.getL2Config();
        const l2Toggle = document.getElementById('weba-l2-encrypt') as HTMLInputElement | null;
        const l2Enabled = !!(l2Config?.enabled && (l2Toggle ? l2Toggle.checked : l2Config.default_enabled));

        if (l2Enabled) {
            if (!l2Config?.recipient_kid || !l2Config?.recipient_x25519 || !l2Config?.layer1_ref) {
                alert('L2 encryption config is missing required fields.');
                return;
            }

            // Create a working copy of config
            const encryptionConfig = { ...l2Config };
            let tier: 'high' | 'standard' | 'offline' = 'offline';

            // Graduated PFS Logic

            // 1. Attempt Tier 3 (Dynamic Pre-key)
            if (l2Config.prekey_url) {
                try {
                    const { fetchPreKey } = await import('./l2crypto');
                    const preKey = await fetchPreKey(l2Config.prekey_url);
                    if (preKey) {
                        console.log("Tier 3 Active: Using dynamic pre-key", preKey.kid);
                        encryptionConfig.recipient_kid = preKey.kid;
                        encryptionConfig.recipient_x25519 = preKey.recipient_x25519;
                        if (preKey.recipient_pqc) {
                            encryptionConfig.recipient_pqc = preKey.recipient_pqc;
                        }
                        tier = 'high';
                    }
                } catch (e) {
                    console.warn("Tier 3 Failed. Falling back to Tier 2.");
                }
            }

            // 2. Attempt Tier 2 (Epoch-based)
            if (tier === 'offline' && l2Config.epoch_registry_url) {
                try {
                    const { fetchEpochRegistry, selectEpochKey } = await import('./l2crypto');
                    const registry = await fetchEpochRegistry(l2Config.epoch_registry_url);
                    if (registry) {
                        const epochKey = selectEpochKey(registry);
                        if (epochKey) {
                            console.log("Tier 2 Active: Using epoch key", epochKey.kid);
                            encryptionConfig.recipient_kid = epochKey.kid;
                            encryptionConfig.recipient_x25519 = epochKey.publicKey;
                            tier = 'standard';
                        }
                    }
                } catch (e) {
                    console.warn("Tier 2 Failed. Falling back to Tier 1.");
                }
            }

            // 3. Fallback Tier 1 (Static) - already in encryptionConfig
            if (tier === 'offline') {
                console.log("Tier 1 Active: Using static master key (Offline Mode)");
            }

            this.updateSecurityUI(tier);

            // GUEST DID INTEGRATION
            let senderDid = l2Config.user_kid;
            const guestDidCheckbox = document.getElementById('weba-guest-did-opt') as HTMLInputElement | null;

            if (guestDidCheckbox && guestDidCheckbox.checked) {
                try {
                    const { getOrCreateGuestDid } = await import('./guest_did');
                    const { did, isReused } = await getOrCreateGuestDid();
                    senderDid = did;
                    console.log(`Using Guest DID: ${did} (Reused: ${isReused})`);
                } catch (e) {
                    console.error("Guest DID creation failed:", e);
                    if (!confirm("Failed to create/retrieve Guest DID for replies. Continue with anonymous submission?")) {
                        return;
                    }
                    // Fallback to anonymous (user_kid from config or form default)
                }
            }

            try {
                const { buildLayer2Envelope } = await import('./l2crypto');
                const envelope = await buildLayer2Envelope({
                    layer2_plain: data,
                    config: encryptionConfig,
                    user_kid: senderDid || "anonymous", // Ensure string
                });
                this.downloadHtml('submit', true, { l2Envelope: envelope, stripPlaintext: true });
            } catch (e) {
                console.error(e);
                alert('L2 encryption failed. Please check your recipient key settings.');
            }
            return;
        }

        // Ensure key is ready (triggers Passkey registration if needed)
        if (!globalSigner.getPublicKey()) {
            const success = await globalSigner.register();
            if (!success) {
                alert("Key registration failed.");
                return;
            }
        }

        const payload = {
            "@context": ["https://www.w3.org/2018/credentials/v1"],
            "type": ["VerifiableCredential", "WebAFormResponse"],
            "issuer": globalSigner.getIssuerDid(),
            "issuanceDate": new Date().toISOString(),
            "credentialSubject": {
                "id": `urn:uuid:${crypto.randomUUID()}`,
                "type": "WebAFormResponse",
                "templateId": templateId,
                "answers": data
            }
        };

        try {
            // HMP (Human-Machine Parity) consistency check
            const uiKeys = new Set<string>();
            document.querySelectorAll('[data-json-path]').forEach((el: any) => uiKeys.add(el.dataset.jsonPath));
            document.querySelectorAll('[type="radio"]').forEach((el: any) => uiKeys.add(el.name));
            document.querySelectorAll('table.data-table.dynamic').forEach((el: any) => uiKeys.add(el.dataset.tableKey));

            const ghostFields: string[] = [];
            const answers = payload.credentialSubject.answers;
            for (const key in answers) {
                if (!uiKeys.has(key) && !key.startsWith('@') && key !== 'type' && key !== 'templateId' && key !== 'id') {
                    ghostFields.push(key);
                }
            }

            if (ghostFields.length > 0) {
                if (!confirm(`WARNING: HMP Variance Detected.\n\nThe following hidden fields will be signed but are not visible in the form UI:\n- ${ghostFields.join('\n- ')}\n\nContinue signing?`)) {
                    return;
                }
            }

            const signedVc = await globalSigner.sign(payload);
            this.downloadHtml('submitted', true, { embeddedVc: signedVc });
        } catch (e) {
            console.error(e);
            alert("Signing failed. Please ensure you are in a secure context (HTTPS/localhost).");
        }
    }

    public saveToLS() {
        const data = this.updateJsonLd();
        localStorage.setItem(this.formId, JSON.stringify(data));
    }

    public restoreFromLS() {
        const c = localStorage.getItem(this.formId);
        if (!c) return;
        try {
            const d = JSON.parse(c);
            // Static
            document.querySelectorAll('[data-json-path]').forEach((input: any) => {
                const key = input.dataset.jsonPath;
                if (d[key] !== undefined) input.value = d[key];
            });
            // Dynamic Tables
            document.querySelectorAll('table.data-table.dynamic').forEach((table: any) => {
                const tableKey = table.dataset.tableKey;
                const rowsData = d[tableKey];
                if (Array.isArray(rowsData)) {
                    const tbody = table.querySelector('tbody');
                    if (!tbody) return;
                    // Remove existing except first template
                    const currentRows = tbody.querySelectorAll('.template-row');
                    // This logic assumes .template-row is always the first one and shouldn't be deleted?
                    // Original code: for (let i = 1; i < currentRows.length; i++) currentRows[i].remove();
                    // But actually usually there is only ONE template row initially.
                    // If user added rows manually before restore (unlikely on reload), they are not template rows usually.
                    // Let's stick to original logic: find all rows? 
                    // Original: const currentRows = tbody.querySelectorAll('.template-row');
                    // Wait, dynamic added rows lose .template-row class!
                    // Original code:
                    // newRow.classList.remove('template-row');
                    // So `tbody.querySelectorAll('.template-row')` only finds the template.
                    // So `currentRows.length` is usually 1. 
                    // AND `restoreFromLS` in original code says:
                    // `const currentRows = tbody.querySelectorAll('.template-row');`
                    // `for (let i = 1; i < currentRows.length; i++) currentRows[i].remove();`
                    // This creates a bug if multiple template rows existed (impossible).
                    // BUT it fails to remove non-template rows (previous session junk if any)?
                    // Actually on page load, HTML only has template row.

                    rowsData.forEach((rowData, idx) => {
                        let row: any;
                        if (idx === 0) {
                            row = tbody.querySelector('.template-row');
                        } else {
                            const tmpl = tbody.querySelector('.template-row');
                            if (tmpl) {
                                row = tmpl.cloneNode(true);
                                (row as Element).classList.remove('template-row'); // Added this to match addTableRow behavior logic
                                // Also unhide delete button
                                const rmBtn = (row as Element).querySelector('.remove-row-btn') as HTMLElement;
                                if (rmBtn) rmBtn.style.visibility = 'visible';

                                tbody.appendChild(row);
                            }
                        }
                        if (row) {
                            row.querySelectorAll('input, select').forEach((input: any) => {
                                const k = input.dataset.baseKey;
                                if (k && rowData[k] !== undefined) {
                                    if (input.type === 'checkbox') input.checked = !!rowData[k];
                                    else input.value = rowData[k];
                                }
                            });
                        }
                    });
                }
            });
        } catch (e) { console.error(e); }
    }

    public clearData() {
        if (confirm('Clear all saved data? / 保存されたデータを削除しますか？')) {
            localStorage.removeItem(this.formId);
            window.location.reload();
        }
    }

    public bakeValues() {
        this.updateJsonLd();
        document.querySelectorAll('input, textarea, select').forEach((el: any) => {
            if (el.closest('.template-row')) return; // Skip template row
            if (el.type === 'checkbox' || el.type === 'radio') {
                if (el.checked) el.setAttribute('checked', 'checked');
                else el.removeAttribute('checked');
            } else {
                el.setAttribute('value', el.value);
                if (el.tagName === 'TEXTAREA') el.textContent = el.value;
            }
        });
    }

    public downloadHtml(
        filenameSuffix: string,
        isFinal: boolean,
        options?: DownloadHtmlOptions,
    ) {
        const w = window as any;
        const title = (w.generatedJsonStructure && w.generatedJsonStructure.name) || 'web-a-form';
        downloadHtml({
            documentHtml: document.documentElement.outerHTML,
            title,
            filenameSuffix,
            isFinal,
            ...(options ? { options } : {}),
        });
    }

    private buildDraftState(): DraftState {
        const data = this.updateJsonLd();
        const savedAt = new Date().toISOString();
        const l2NoncesRaw = localStorage.getItem(DataManager.L2_REPLAY_STORE_KEY);
        let replayNonces: string[] | undefined;
        if (l2NoncesRaw) {
            try {
                const parsed = JSON.parse(l2NoncesRaw);
                if (Array.isArray(parsed)) {
                    replayNonces = parsed.filter((value) => typeof value === "string");
                }
            } catch (e) {
                console.warn("Failed to parse L2 replay store for draft", e);
            }
        }
        return {
            version: DataManager.DRAFT_STATE_VERSION,
            savedAt,
            formId: this.formId,
            formData: data,
            ...(replayNonces ? { l2State: { replayNonces } } : {}),
        };
    }

    public saveDraft() {
        const draftState = this.buildDraftState();
        this.bakeValues();
        this.downloadHtml('draft', false, { draftState });
    }

    public submitDocument() {
        // CHECK VALIDATION FIRST (same as signAndDownload)
        const validationResult = checkRequiredFields();

        if (!validationResult.isValid) {
            // Show confirmation dialog
            this.validationDialog.show({
                missingFields: validationResult.missingFields,
                onCancel: () => {
                    console.log('[DataManager] User cancelled submission');
                    // Return to form - nothing to do
                },
                onSubmit: () => {
                    console.log('[DataManager] User confirmed submission despite missing fields');
                    // Proceed with actual submission
                    this.performSubmitDocument();
                }
            });
            return; // Stop here - let dialog handle next steps
        }

        // If valid, proceed directly
        this.performSubmitDocument();
    }

    private performSubmitDocument() {
        this.bakeValues();
        document.querySelectorAll('.search-suggestions').forEach(el => el.remove());
        this.downloadHtml('submit', true);
    }
}
