import { Calculator } from './calculator';
import { DataManager } from './data';
import { UIManager } from './ui';
import type { PostalRecord } from './postal';
import { parseFieldName, isSameGroup, detectFieldType } from './postal-group';

/**
 * Web/A Runtime Core
 */
export function initRuntime() {
    console.log("Web/A Runtime Booting...");
    const calc = new Calculator();
    const dm = new DataManager();
    const uim = new UIManager(calc, dm);
    const w = window as any;

    // --- 1. Modular Feature Initializers ---
    const initPostal = () => {
        if (w.postalLookup && !w.__postalInitialized) {
            w.__postalInitialized = true;
            w.postalLookup.autoInit().then(() => console.log("📮 Postal lookup ready."));
        }
    };

    const initLg = () => {
        if (w.lgLookup && !w.__lgInitialized) {
            w.__lgInitialized = true;
            w.lgLookup.autoInit().then(() => console.log("🏛️ LG lookup ready."));
        }
    };

    // --- 2. Load Data Islands (Async Gzip support) ---
    // Try to load from manifest first (Blob-based), then fallback to direct element
    const loadStructureData = async () => {
        const manifest = w.__WEBA_MANIFEST;
        if (manifest && manifest.blobs) {
            const structureBlob = manifest.blobs.find((b: any) => b.id === 'weba-structure');
            if (structureBlob && structureBlob.urls) {
                console.log('[Runtime] Found weba-structure in manifest');
                for (const url of structureBlob.urls) {
                    try {
                        let jsonString: string;
                        if (url.startsWith('#')) {
                            const el = document.querySelector(url);
                            if (!el || !el.textContent) continue;
                            const bin = atob(el.textContent.trim());
                            const ui8 = new Uint8Array(bin.length);
                            for (let i = 0; i < bin.length; i++) ui8[i] = bin.charCodeAt(i);

                            // Check if the blob is gzip-compressed
                            if (structureBlob.mediaType === 'application/x-gzip') {
                                const stream = new Blob([ui8]).stream().pipeThrough(new DecompressionStream('gzip'));
                                jsonString = await new Response(stream).text();
                            } else {
                                // For JSON, just decode the binary data
                                jsonString = new TextDecoder().decode(ui8);
                            }
                        } else {
                            const resp = await fetch(url);
                            if (!resp.ok) continue;
                            jsonString = await resp.text();
                        }
                        const data = JSON.parse(jsonString);
                        console.log('[Runtime] Structure data loaded from blob. Keys:', Object.keys(data));
                        return data;
                    } catch (e) {
                        console.warn('[Runtime] Failed to load structure from:', url, e);
                    }
                }
            }
        }

        // Fallback to direct element access
        const structureScript = document.getElementById('weba-structure') as HTMLScriptElement;
        if (structureScript) {
            console.log('[Runtime] Loading structure from direct element');
            return await tryLoadJson(structureScript);
        }

        console.warn('[Runtime] weba-structure not found in manifest or DOM');
        return null;
    };

    loadStructureData().then(s => {
        if (s) {
            w.generatedJsonStructure = s;
            console.log('[Runtime] generatedJsonStructure set');
            uim.applyI18n(); uim.initTelFormatter(); calc.recalculate(); uim.updateVisibility();
            updateSubmitButtonState(); // Validate once structure is checked

            // Check if document is in submitted state and update UI accordingly
            initSubmittedState();

            // Initialize SearchEngine after structure data is loaded
            if (w.SearchEngine && typeof w.SearchEngine.init === 'function') {
                console.log('[Runtime] Calling SearchEngine.init()...');
                w.SearchEngine.init().catch((err: any) => console.error('SearchEngine init failed:', err));
            }
        } else {
            console.warn('[Runtime] Failed to load structure data');
        }
    }).catch(err => {
        console.error('[Runtime] Error loading structure:', err);
    });
    const l2ConfigEl = document.getElementById("weba-l2-config") as HTMLScriptElement;
    if (l2ConfigEl) {
        tryLoadJson(l2ConfigEl).then(c => {
            if (c) {
                w.webaL2Config = c;
                initSecuritySignal(c); initGuestDidOpt(c);
            }
        });
    }

    // --- 3. Global Action Bindings ---
    w.saveDraft = () => dm.saveDraft();
    w.submitDocument = () => dm.submitDocument();
    w.signAndDownload = () => dm.signAndDownload();
    w.clearData = () => dm.clearData();
    w.withdrawDocument = () => handleWithdrawOrReturn('Withdraw');
    w.returnDocument = () => handleWithdrawOrReturn('Return');
    w.removeTableRow = (btn: any) => uim.removeTableRow(btn);
    w.addTableRow = (btn: any, tableKey: string) => uim.addTableRow(btn, tableKey);
    w.switchTab = (btn: any, tabId: string) => uim.switchTab(btn, tabId);
    w.recalculate = () => calc.recalculate();

    // --- 4. Startup Sequences ---
    dm.restoreFromLS();
    uim.applyI18n();
    uim.initTables();
    calc.recalculate();

    if (w.initL2Viewer) w.initL2Viewer();
    if (w.initKeywrapTool) w.initKeywrapTool();
    if (w.initAggregatorBrowser) w.initAggregatorBrowser();
    initPostal();
    initLg();

    // --- 5. Global Event Handling ---
    let tm: any;
    document.addEventListener('input', (e) => {
        const input = e.target as HTMLInputElement;
        if (!input || input.tagName !== 'INPUT') return;
        if (e.isTrusted) input.dataset.dirty = 'true';

        let key = (input.dataset.jsonPath || input.name || '').toLowerCase();
        const val = input.value.trim();
        const postal = w.postalLookup;

        // A. Postal & Address Suggestions (Datalist based)
        // Skip if this is a search-input field - SearchEngine will handle it
        const isSearchInput = input.classList.contains('search-input');
        if (postal && postal.isReady() && !isSearchInput) {
            key = (input.dataset.jsonPath || input.dataset.baseKey || input.name || input.id || '').toLowerCase();
            const placeholder = (input.placeholder || '').toLowerCase();
            const autofill = input.dataset.autofill || '';

            // Determine field type: prioritize autofill attribute, fallback to key/placeholder
            let fieldType = '';
            if (autofill.startsWith('postal:')) {
                fieldType = autofill.replace('postal:', '');
            } else {
                // Fallback: auto-detect from key/placeholder
                if ((key.match(/zip|postal|postcode|郵便/) && !key.match(/pref|city|town|address|都道府県|市区町村|住所/))
                    || placeholder.match(/郵便|zip|postal/)) {
                    fieldType = 'zip';
                } else if (key.match(/pref|都道府県/)) {
                    fieldType = 'pref';
                } else if (key.match(/city|市区町村/)) {
                    fieldType = 'city';
                } else if (key.match(/town|町名|町字/)) {
                    fieldType = 'town';
                } else if (key.match(/address|住所/)) {
                    fieldType = 'address';
                }
            }

            if (fieldType) {
                // Ensure datalist exists (Support dynamic rows)
                let listId = input.getAttribute('list');
                if (!listId) {
                    listId = `dl-${Math.random().toString(36).substring(2, 7)}`;
                    input.setAttribute('list', listId);
                    const dl = document.createElement('datalist'); dl.id = listId; document.body.appendChild(dl);
                }
                const datalist = document.getElementById(listId);

                if (fieldType === 'zip') {
                    const cleanVal = val.replace(/[^0-9]/g, '');
                    if (datalist && cleanVal.length >= 3) {
                        const candidates = postal.suggest(cleanVal, 50) as PostalRecord[];
                        datalist.innerHTML = candidates.map(c => `<option value="${c.zip.substring(0, 3)}-${c.zip.substring(3)}">${c.pref}${c.city}${c.town}</option><option value="${c.zip}">${c.pref}${c.city}${c.town}</option>`).join('');
                    }
                    if (cleanVal.length === 7) {
                        const addr = postal.lookup(cleanVal);
                        if (addr) fillAddress(input, addr, input.closest('tr') || input.closest('.dynamic-row') || input.closest('.address-group') || input.closest('table') || input.closest('form') || document.body);
                    }
                } else if (fieldType === 'pref') {
                    // 都道府県フィールド：都道府県名のみサジェスト
                    if (datalist && val.length >= 1) {
                        const candidates = postal.suggestByAddress(val, 50) as PostalRecord[];
                        const uniquePrefs = [...new Set(candidates.map(c => c.pref))].slice(0, 10);
                        datalist.innerHTML = uniquePrefs.map(pref => `<option value="${pref}">${pref}</option>`).join('');
                    }
                } else if (fieldType === 'city') {
                    // 市区町村フィールド：市区町村名のみサジェスト
                    if (datalist && val.length >= 1) {
                        const candidates = postal.suggestByAddress(val, 50) as PostalRecord[];
                        const uniqueCities = [...new Set(candidates.map(c => c.city))].slice(0, 20);
                        datalist.innerHTML = uniqueCities.map(city => `<option value="${city}">${city}</option>`).join('');
                    }
                } else if (fieldType === 'town' || fieldType === 'address') {
                    // 町名・住所フィールド：町名のみサジェスト
                    if (datalist && val.length >= 2) {
                        const candidates = postal.suggestByAddress(val, 30) as PostalRecord[];
                        datalist.innerHTML = candidates.map(c => `<option value="${c.town}">${c.pref}${c.city}${c.town}</option>`).join('');
                    }
                }
            }
        }

        // A-2. LG Code Autocomplete
        const lg = w.lgLookup;
        if (lg && lg.isReady() && !isSearchInput) {
            const autofill = input.dataset.autofill || '';

            // Helper: Get related fields in the same scope
            const getRelatedLgFields = (currentInput: HTMLInputElement) => {
                const scope = currentInput.closest('tr') || currentInput.closest('.dynamic-row') || currentInput.closest('.group') || currentInput.closest('form') || document.body;
                const inputs = Array.from(scope.querySelectorAll('input, select, textarea')) as HTMLInputElement[];

                let codeField: HTMLInputElement | null = null;
                let prefField: HTMLInputElement | null = null;
                let cityField: HTMLInputElement | null = null;

                inputs.forEach((inp) => {
                    const af = inp.dataset.autofill || '';
                    const k = (inp.dataset.jsonPath || inp.name || inp.id || '').toLowerCase();

                    if (af === 'lg' || k.match(/lg_code|lgcode|自治体コード/)) {
                        codeField = inp;
                    } else if (af === 'lg:pref' || k.match(/pref|都道府県/)) {
                        prefField = inp;
                    } else if (af === 'lg:city' || k.match(/city|市区町村/)) {
                        cityField = inp;
                    }
                });

                return { codeField, prefField, cityField };
            };

            // Helper: Auto-fill related fields
            const fillLgFields = (lgRecord: any, currentInput: HTMLInputElement) => {
                const { codeField, prefField, cityField } = getRelatedLgFields(currentInput);

                [
                    { field: codeField, value: lgRecord.code },
                    { field: prefField, value: lgRecord.pref },
                    { field: cityField, value: lgRecord.city }
                ].forEach(({ field, value }) => {
                    if (field && field !== currentInput && value && field.value !== value) {
                        field.value = value;
                        field.dataset.dirty = 'true';
                        field.style.backgroundColor = '#e0f2fe';
                        setTimeout(() => { field.style.backgroundColor = ''; }, 500);
                        field.dispatchEvent(new Event('input', { bubbles: true }));
                        field.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            };

            if (autofill === 'lg') {
                // === LG Code Field ===
                let listId = input.getAttribute('list');
                if (!listId) {
                    listId = `dl-lg-${Math.random().toString(36).substring(2, 7)}`;
                    input.setAttribute('list', listId);
                    const dl = document.createElement('datalist'); dl.id = listId; document.body.appendChild(dl);
                }
                const datalist = document.getElementById(listId);

                const cleanVal = val.replace(/[^0-9]/g, '');

                // Suggest by code prefix
                if (datalist && cleanVal.length >= 2 && cleanVal.length < 6) {
                    const candidates = lg.suggest(cleanVal, 30);
                    datalist.innerHTML = candidates.map(c =>
                        `<option value="${c.code}">${c.pref} ${c.city}</option>`
                    ).join('');
                }

                // Auto-fill on exact match (6 digits)
                if (cleanVal.length === 6) {
                    const lgRecord = lg.lookup(cleanVal);
                    if (lgRecord) fillLgFields(lgRecord, input);
                }
            } else if (autofill === 'lg:pref') {
                // === Prefecture Field ===
                let listId = input.getAttribute('list');
                if (!listId) {
                    listId = `dl-lg-pref-${Math.random().toString(36).substring(2, 7)}`;
                    input.setAttribute('list', listId);
                    const dl = document.createElement('datalist'); dl.id = listId; document.body.appendChild(dl);
                }
                const datalist = document.getElementById(listId);

                if (datalist && val.length >= 1) {
                    const allPrefs = lg.getUniquePrefectures();
                    const filtered = allPrefs.filter(p => p.includes(val)).slice(0, 20);
                    datalist.innerHTML = filtered.map(p => `<option value="${p}">${p}</option>`).join('');
                }
            } else if (autofill === 'lg:city') {
                // === City Field ===
                let listId = input.getAttribute('list');
                if (!listId) {
                    listId = `dl-lg-city-${Math.random().toString(36).substring(2, 7)}`;
                    input.setAttribute('list', listId);
                    const dl = document.createElement('datalist'); dl.id = listId; document.body.appendChild(dl);
                }
                const datalist = document.getElementById(listId);

                if (datalist && val.length >= 1) {
                    const { prefField } = getRelatedLgFields(input);
                    const prefValue = prefField ? prefField.value.trim() : '';

                    let candidates;
                    if (prefValue) {
                        // Filter by prefecture
                        candidates = lg.suggestCitiesByPref(prefValue, val, 30);
                        datalist.innerHTML = candidates.map(c =>
                            `<option value="${c.city}">${c.city}</option>`
                        ).join('');
                    } else {
                        // Show all cities with prefecture
                        candidates = lg.suggestByCity(val, undefined, 30);
                        datalist.innerHTML = candidates.map(c =>
                            `<option value="${c.city}">${c.pref} ${c.city}</option>`
                        ).join('');
                    }

                    // Auto-fill on exact match
                    const exactMatch = candidates.find(c => c.city === val);
                    if (exactMatch) {
                        fillLgFields(exactMatch, input);
                    }
                }
            }
        }

        // B. Master Data Search (Support for Medical Expense Demo etc.)
        if (input.classList.contains('search-input') && w.SearchEngine) {
            // If SearchEngine is globally available, the individual module for search (form-search.js) 
            // should have attached its own listeners or we trigger it here.
        }

        // C. Data-Copy & Recalculation
        if (key) {
            const scope = input.closest('tr') || input.closest('.dynamic-row') || input.closest('.group') || document;
            scope.querySelectorAll(`[data-copy-from="${key}"]`).forEach((dest: any) => {
                if (!dest.dataset.dirty && dest.value !== input.value) {
                    dest.value = input.value;
                    dest.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
        }
        calc.recalculate(); uim.updateVisibility(); dm.updateJsonLd();

        // D. Validation Check
        updateSubmitButtonState();

        clearTimeout(tm); tm = setTimeout(() => dm.saveToLS(), 1000);
    });

    // Initial check
    setTimeout(updateSubmitButtonState, 500);

    // Change event for datalist selection (LG autocomplete)
    document.addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        if (!input || input.tagName !== 'INPUT') return;

        const autofill = input.dataset.autofill || '';
        const lg = w.lgLookup;

        // LG City field: Auto-fill on selection from datalist
        if (lg && lg.isReady() && autofill === 'lg:city') {
            const val = input.value.trim();
            if (!val) return;

            const scope = input.closest('tr') || input.closest('.dynamic-row') || input.closest('.group') || input.closest('form') || document.body;
            const inputs = Array.from(scope.querySelectorAll('input, select, textarea')) as HTMLInputElement[];

            let prefField: HTMLInputElement | null = null;
            inputs.forEach((inp) => {
                const af = inp.dataset.autofill || '';
                const k = (inp.dataset.jsonPath || inp.name || inp.id || '').toLowerCase();
                if (af === 'lg:pref' || k.match(/pref|都道府県/)) {
                    prefField = inp;
                }
            });

            const prefValue = prefField ? prefField.value.trim() : '';

            // Search for matching city
            const candidates = prefValue
                ? lg.suggestCitiesByPref(prefValue, val, 50)
                : lg.suggestByCity(val, undefined, 50);

            const exactMatch = candidates.find(c => c.city === val);
            if (exactMatch) {
                // Fill related fields
                inputs.forEach((targetInput) => {
                    if (targetInput === input) return;
                    const af = targetInput.dataset.autofill || '';
                    const k = (targetInput.dataset.jsonPath || targetInput.name || targetInput.id || '').toLowerCase();

                    let valueToSet = '';
                    if (af === 'lg' || k.match(/lg_code|lgcode|自治体コード/)) {
                        valueToSet = exactMatch.code;
                    } else if (af === 'lg:pref' || k.match(/pref|都道府県/)) {
                        valueToSet = exactMatch.pref;
                    }

                    if (valueToSet && targetInput.value !== valueToSet) {
                        targetInput.value = valueToSet;
                        targetInput.dataset.dirty = 'true';
                        targetInput.style.backgroundColor = '#e0f2fe';
                        setTimeout(() => { targetInput.style.backgroundColor = ''; }, 500);
                        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
                        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });

                calc.recalculate(); uim.updateVisibility(); dm.updateJsonLd();
            }
        }
    });

    console.log("Web/A Runtime Ready.");
}

function checkRequired(): boolean {
    const w = window as any;
    // Check fields based on jsonStructure.fields definitions
    if (!w.generatedJsonStructure || !w.generatedJsonStructure.fields) {
        // If config not loaded yet, disable submit to be safe
        return false;
    }

    // Filter visible inputs that are required
    const inputs = Array.from(document.querySelectorAll('input, select, textarea')) as HTMLInputElement[];
    for (const input of inputs) {
        // Skip hidden inputs (e.g. by show_if)
        if (input.offsetParent === null) continue;

        const key = input.dataset.jsonPath || input.name;
        if (!key) continue;

        // Find field definition
        const fieldDef = w.generatedJsonStructure.fields.find((f: any) => f.key === key);
        if (fieldDef && fieldDef.required) {
            if (input.type === 'checkbox') {
                if (!input.checked) {
                    console.log(`[Validation] Required Checkbox missing: ${key}`);
                    return false;
                }
            } else if (input.type === 'radio') {
                const group = document.getElementsByName(input.name);
                let checked = false;
                for (let i = 0; i < group.length; i++) {
                    if ((group[i] as HTMLInputElement).checked) {
                        checked = true;
                        break;
                    }
                }
                if (!checked) {
                    console.log(`[Validation] Required Radio missing: ${key}`);
                    return false;
                }
            } else {
                if (!input.value.trim()) {
                    console.log(`[Validation] Required Field empty: ${key}`);
                    return false;
                }
            }
        }
    }
    return true;
}

function updateSubmitButtonState() {
    const btn = document.getElementById('btn-submit') as HTMLButtonElement;
    if (!btn) return;
    const valid = checkRequired();

    // Update visual classes instead of disabled attribute
    if (valid) {
        btn.classList.remove('btn-submit-incomplete');
        btn.classList.add('btn-submit-ready');
        btn.title = '';
    } else {
        btn.classList.remove('btn-submit-ready');
        btn.classList.add('btn-submit-incomplete');
        const isJa = (navigator.language || '').toLowerCase().startsWith('ja');
        btn.title = isJa ? '必須項目が未入力です（クリックして確認）' : 'Required fields missing (click to review)';
    }
}

/**
 * 住所自動入力ヘルパー（グループ対応版）
 */
function fillAddress(triggerInput: HTMLInputElement, record: PostalRecord, scope: Element, includeZip = false) {
    // トリガーフィールドのグループ情報を解析
    const sourceField = parseFieldName(triggerInput);

    // グループがない場合は警告
    if (!sourceField.group) {
        console.warn('[fillAddress] グループプレフィックスが必要です。フィールド名:', sourceField.raw);
        return;
    }

    const inputs = Array.from(scope.querySelectorAll('input, select, textarea')) as HTMLInputElement[];

    // 同じグループのフィールドのみをフィルタリング
    const groupedInputs = inputs
        .map(inp => ({ element: inp, parsed: parseFieldName(inp) }))
        .filter(({ parsed }) => isSameGroup(sourceField, parsed));

    // 個別フィールドの存在をチェック
    const hasPref = groupedInputs.some(({ element: inp, parsed }) => {
        if (inp === triggerInput) return false;
        return detectFieldType(parsed.fieldType || '') === 'pref';
    });
    const hasCity = groupedInputs.some(({ element: inp, parsed }) => {
        if (inp === triggerInput) return false;
        return detectFieldType(parsed.fieldType || '') === 'city';
    });
    const hasTown = groupedInputs.some(({ element: inp, parsed }) => {
        if (inp === triggerInput) return false;
        return detectFieldType(parsed.fieldType || '') === 'town';
    });

    groupedInputs.forEach(({ element: input, parsed }) => {
        if (input === triggerInput) return;

        const fieldType = detectFieldType(parsed.fieldType || '');
        let valToSet = '';

        if (includeZip && fieldType === 'zip') {
            valToSet = record.zip.substring(0, 3) + '-' + record.zip.substring(3);
        } else if (fieldType === 'pref') {
            valToSet = record.pref;
        } else if (fieldType === 'city') {
            valToSet = record.city;
        } else if (fieldType === 'town') {
            valToSet = record.town;
        } else if (fieldType === 'address') {
            // 個別フィールドで入力されていない部分のみ
            if (!hasPref && !hasCity && !hasTown) {
                // 個別フィールドが全くない場合：完全な住所
                valToSet = `${record.pref}${record.city}${record.town}`;
            } else if (hasPref && !hasCity && !hasTown) {
                // prefのみがある場合：市区町村+町名
                valToSet = `${record.city}${record.town}`;
            } else if (!hasTown) {
                // pref/cityのいずれかがある場合：町名のみ
                valToSet = record.town;
            }
            // townがある場合は、addressには何も入れない
        }

        if (valToSet && input.value !== valToSet) {
            input.value = valToSet;
            input.dataset.dirty = 'true';
            input.style.backgroundColor = '#e0f2fe';
            setTimeout(() => { input.style.backgroundColor = ''; }, 500);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });
}

/**
 * Gzip透過ロード用ヘルパー
 */
async function tryLoadJson(el: HTMLScriptElement): Promise<any> {
    if (!el.textContent) return null;
    let text = el.textContent.trim();
    if (el.type === 'application/x-gzip') {
        try {
            const bin = atob(text);
            const ui8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) ui8[i] = bin.charCodeAt(i);
            const stream = new Blob([ui8]).stream().pipeThrough(new DecompressionStream('gzip'));
            text = await new Response(stream).text();
        } catch (e) { return null; }
    }
    try { return JSON.parse(text); } catch (e) { return null; }
}

function initSecuritySignal(l2Config: any) {
    const toolbar = document.querySelector('.form-toolbar');
    if (!toolbar) return;
    const signal = document.createElement('div');
    signal.id = 'weba-security-signal';
    signal.className = 'security-badge';
    toolbar.appendChild(signal);
    (async () => {
        let tier: 'high' | 'standard' | 'offline' = 'offline';
        if (l2Config.prekey_url) {
            try { if ((await fetch(l2Config.prekey_url, { method: 'HEAD' })).ok) tier = 'high'; } catch (e) { }
        }
        window.dispatchEvent(new CustomEvent('weba-security-tier-change', { detail: { tier } }));
    })();
}

function initGuestDidOpt(l2Config: any) {
    if (!l2Config?.enabled || !(window as any).PublicKeyCredential) return;
    const submitBtn = document.querySelector('button[onclick*="signAndDownload"]');
    if (submitBtn && submitBtn.parentElement) {
        const opt = document.createElement('div');
        opt.className = 'weba-guest-opt no-print';
        opt.style.cssText = 'display:flex;align-items:center;gap:6px;margin-right:12px;';
        opt.innerHTML = `<input type="checkbox" id="weba-guest-did-opt"><label for="weba-guest-did-opt" style="font-size:13px;color:#555;cursor:pointer;">返信を受け取る (Passkey)</label>`;
        submitBtn.parentElement.insertBefore(opt, submitBtn);
    }
}

/**
 * Initialize submitted state UI
 * - Display confirmation time banner
 * - Replace action buttons with withdrawal/return buttons
 */
export function initSubmittedState() {
    const submittedScript = document.getElementById('weba-submitted') as HTMLScriptElement;
    if (!submittedScript || !submittedScript.textContent) return;

    try {
        const submittedData = JSON.parse(submittedScript.textContent);
        if (!submittedData.submitted) return;

        const confirmedAt = submittedData.confirmedAt || submittedData.submittedAt;
        if (!confirmedAt) return;

        // Display confirmation time banner
        displayConfirmationBanner(confirmedAt);

        // Replace action buttons
        replaceActionButtons();

        // Make form read-only
        makeFormReadOnly();

        console.log('[Runtime] Submitted state initialized');
    } catch (e) {
        console.error('[Runtime] Failed to parse submitted data:', e);
    }
}

/**
 * Display confirmation time banner at the top
 */
export function displayConfirmationBanner(confirmedAt: string) {
    const isJa = (navigator.language || '').toLowerCase().startsWith('ja');
    const date = new Date(confirmedAt);
    const formattedDate = date.toLocaleString(isJa ? 'ja-JP' : 'en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const banner = document.createElement('div');
    banner.className = 'weba-confirmation-banner';
    banner.style.cssText = 'background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border: 2px solid #10b981; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.2);';
    banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-size: 1.5rem;">✓</span>
            <div>
                <div style="font-weight: 600; color: #047857; font-size: 1rem; margin-bottom: 0.25rem;">
                    ${isJa ? '確定済みフォーム' : 'Confirmed Form'}
                </div>
                <div style="color: #065f46; font-size: 0.9rem;">
                    ${isJa ? '確定時刻' : 'Confirmed at'}: <strong>${formattedDate}</strong>
                </div>
            </div>
        </div>
    `;

    const page = document.querySelector('.page');
    if (page && page.parentElement) {
        page.parentElement.insertBefore(banner, page);
    }
}

/**
 * Replace action buttons with withdrawal/return buttons
 */
export function replaceActionButtons() {
    // Support both .action-bar and .no-print (form toolbar)
    const actionBar = document.querySelector('.action-bar') ||
                      document.querySelector('.no-print[style*="display: flex"]');
    if (!actionBar) return;

    const isJa = (navigator.language || '').toLowerCase().startsWith('ja');

    actionBar.innerHTML = `
        <div style="flex: 1"></div>
        <button class="warning" onclick="withdrawDocument()" data-i18n="withdraw_btn">${isJa ? '取下' : 'Withdraw'}</button>
        <button class="warning" onclick="returnDocument()" data-i18n="return_btn">${isJa ? '差戻' : 'Return'}</button>
    `;
}

/**
 * Make form inputs read-only
 */
export function makeFormReadOnly() {
    document.querySelectorAll('input, textarea, select').forEach((el: any) => {
        el.setAttribute('readonly', 'readonly');
        el.setAttribute('disabled', 'disabled');
        el.style.backgroundColor = '#f3f4f6';
        el.style.cursor = 'not-allowed';
    });
}

/**
 * Handle withdrawal or return action
 */
export function handleWithdrawOrReturn(actionType: 'Withdraw' | 'Return') {
    const isJa = (navigator.language || '').toLowerCase().startsWith('ja');
    const actionLabel = actionType === 'Withdraw'
        ? (isJa ? '取下' : 'Withdrawal')
        : (isJa ? '差戻' : 'Return');

    // Show dialog asking for reason
    const reason = prompt(
        isJa
            ? `${actionLabel}の理由を入力してください：`
            : `Please enter the reason for ${actionLabel.toLowerCase()}:`
    );

    if (!reason || reason.trim() === '') {
        alert(isJa ? '理由が入力されていません。' : 'Reason is required.');
        return;
    }

    // Update L3 metadata
    const submittedScript = document.getElementById('weba-submitted') as HTMLScriptElement;
    if (!submittedScript || !submittedScript.textContent) {
        console.error('[Runtime] No submitted data found');
        return;
    }

    try {
        const submittedData = JSON.parse(submittedScript.textContent);

        // Add new event to L3 metadata
        if (!submittedData.l3Metadata) {
            submittedData.l3Metadata = { events: [] };
        }

        submittedData.l3Metadata.events.push({
            type: actionType,
            timestamp: new Date().toISOString(),
            payload: { reason: reason.trim() }
        });

        // Mark as no longer in submitted state
        submittedData.submitted = false;
        submittedData.withdrawnOrReturned = true;
        submittedData.lastAction = actionType;
        submittedData.lastActionReason = reason.trim();

        // Update the script element
        submittedScript.textContent = JSON.stringify(submittedData, null, 2);

        // Make form editable again
        makeFormEditable();

        // Remove confirmation banner
        const banner = document.querySelector('.weba-confirmation-banner');
        if (banner) banner.remove();

        // Restore original action buttons
        restoreActionButtons();

        // Download updated HTML
        const w = window as any;
        const title = (w.generatedJsonStructure && w.generatedJsonStructure.name) || 'web-a-form';
        const htmlContent = document.documentElement.outerHTML;
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        const now = new Date();
        const dateStr = now.getFullYear() +
            ('0' + (now.getMonth() + 1)).slice(-2) +
            ('0' + now.getDate()).slice(-2) +
            '-' +
            ('0' + now.getHours()).slice(-2) +
            ('0' + now.getMinutes()).slice(-2);
        const randomId = Math.random().toString(36).substring(2, 8);
        const suffix = actionType.toLowerCase();
        a.download = `${title}_${dateStr}_${suffix}_${randomId}.html`;

        a.click();

        alert(
            isJa
                ? `${actionLabel}が完了しました。更新されたフォームがダウンロードされました。`
                : `${actionLabel} completed. Updated form has been downloaded.`
        );

    } catch (e) {
        console.error('[Runtime] Failed to process withdrawal/return:', e);
        alert(
            isJa
                ? 'エラーが発生しました。'
                : 'An error occurred.'
        );
    }
}

/**
 * Make form inputs editable
 */
function makeFormEditable() {
    document.querySelectorAll('input, textarea, select').forEach((el: any) => {
        el.removeAttribute('readonly');
        el.removeAttribute('disabled');
        el.style.backgroundColor = '';
        el.style.cursor = '';
    });
}

/**
 * Restore original action buttons
 */
export function restoreActionButtons() {
    // Support both .action-bar and .no-print (form toolbar)
    const actionBar = document.querySelector('.action-bar') ||
                      document.querySelector('.no-print[style*="display: flex"]');
    if (!actionBar) return;

    const isJa = (navigator.language || '').toLowerCase().startsWith('ja');

    actionBar.innerHTML = `
        <div style="flex: 1"></div>
        <button class="btn-clear" data-action="clear-data" data-i18n="clear_btn">${isJa ? '消去' : 'Clear'}</button>
        <button class="secondary" data-action="save-draft" data-i18n="work_save_btn">${isJa ? '下書き保存' : 'Save Draft'}</button>
        <button class="primary btn-submit-incomplete" id="btn-submit" data-action="submit-document" data-i18n="sign_btn">${isJa ? '確定' : 'Confirm'}</button>
    `;
}
