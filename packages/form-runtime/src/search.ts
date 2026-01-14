import type { PostalRecord } from './postal';
import './postal'; // Ensure side-effects run
import { parseFieldName, isSameGroup, detectFieldType } from './postal-group';

function escapeHtml(str: string): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export class SearchEngine {
    private suggestionsVisible = false;
    private activeSearchInput: HTMLInputElement | null = null;
    private globalBox: HTMLElement | null = null;
    private postalReady = false;

    constructor() {
        // Postal lookup will be initialized in init() method
    }

    private async initPostalLookup() {
        try {
            const postal = (window as any).postalLookup;
            if (postal) {
                await postal.autoInit();
                this.postalReady = postal.isReady();
                if (this.postalReady) {
                    console.log('📮 Postal lookup enabled');
                }
            }
        } catch (error) {
            console.warn('Postal lookup not available:', error);
        }
    }

    public async init() {
        console.log("Initializing Search Engine (Bundle)...");

        // Wait for postal lookup to be ready
        await this.initPostalLookup();

        const w = window as any;
        const jsonStructure = w.generatedJsonStructure;

        // --- Master Data Loading (including Blobs) ---
        if (jsonStructure) {
            if (jsonStructure.masterDataRefs) {
                await this.loadMasterDataFromBlobs(jsonStructure);
            }

            if (jsonStructure.masterData) {
                const keys = Object.keys(jsonStructure.masterData);
                console.log("Master Data Keys available:", keys.join(', '));
            }
        }

        this.setupEventDelegation();
        console.log("Search Engine ready. Postal enabled:", this.postalReady);
    }

    /**
     * マニフェストからBlob化されたマスターデータをロード
     */
    private async loadMasterDataFromBlobs(jsonStructure: any) {
        const manifest = (window as any).__WEBA_MANIFEST;
        if (!manifest || !manifest.blobs) return;

        const refs = jsonStructure.masterDataRefs;
        jsonStructure.masterData = jsonStructure.masterData || {};

        for (const [key, digest] of Object.entries(refs)) {
            const blobEntry = manifest.blobs.find((b: any) => b.digest === digest);
            if (!blobEntry || !blobEntry.urls) continue;

            for (const url of blobEntry.urls) {
                try {
                    let jsonString: string;
                    if (url.startsWith('#')) {
                        const el = document.querySelector(url);
                        if (!el || !el.textContent) continue;
                        // Decompress gzip-compressed blob
                        const bin = atob(el.textContent.trim());
                        const ui8 = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) ui8[i] = bin.charCodeAt(i);
                        const stream = new Blob([ui8]).stream().pipeThrough(new DecompressionStream('gzip'));
                        jsonString = await new Response(stream).text();
                    } else {
                        const resp = await fetch(url);
                        if (!resp.ok) continue;
                        jsonString = await resp.text();
                    }

                    jsonStructure.masterData[key] = JSON.parse(jsonString);
                    console.log(`📮 Master data '${key}' loaded from blob:`, digest);
                    break; // Success
                } catch (e) {
                    console.warn(`Failed to load master data blob ${key} from ${url}:`, e);
                }
            }
        }
    }


    private normalize(val: string): string {
        if (!val) return '';
        let n = val.toString().toLowerCase();
        n = n.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        });
        n = n.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
        return n.trim();
    }

    private clean(s: string): string {
        if (!s) return '';
        let n = this.normalize(s);
        n = n.replace(/(株式会社|有限会社|合同会社|一般社団法人|公益社団法人|npo法人|学校法人|社会福祉法人)/g, '');
        n = n.replace(/(\(株\)|\(有\)|\(同\))/g, '');
        return n.trim();
    }

    private toIndex(raw?: string): number {
        const parsed = parseInt(raw || '', 10);
        return Number.isFinite(parsed) ? parsed - 1 : -1;
    }

    /**
     * 郵便番号フィールドかどうかを判定
     */
    private isPostalField(input: HTMLInputElement): boolean {
        // Check data-autofill attribute first (explicit annotation takes priority)
        const autofill = input.dataset.autofill || '';
        if (autofill.startsWith('postal:')) {
            return true;
        }

        // Fallback to old detection logic (for backwards compatibility)
        const key = (input.dataset.jsonPath || input.dataset.baseKey || input.name || input.id || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const isZipKey = (key.match(/zip|postal|postcode|郵便/) && !key.match(/pref|city|town|address|都道府県|市区町村|住所/));
        const isZipPlaceholder = placeholder.match(/郵便|zip|postal/);
        return Boolean(isZipKey || isZipPlaceholder);
    }

    /**
     * 郵便番号入力の処理
     */
    private handlePostalInput(input: HTMLInputElement) {
        console.log('[SearchEngine] handlePostalInput - postalReady:', this.postalReady);

        if (!this.postalReady) {
            console.log('[SearchEngine] Postal not ready, hiding suggestions');
            this.hideSuggestions();
            return;
        }

        const value = input.value.replace(/[^0-9]/g, '');
        console.log('[SearchEngine] Cleaned postal value:', value);

        // 3桁未満は候補なし
        if (value.length < 3) {
            console.log('[SearchEngine] Value too short (<3), hiding suggestions');
            this.hideSuggestions();
            return;
        }

        const postal = (window as any).postalLookup;
        if (!postal) {
            console.log('[SearchEngine] ERROR: postalLookup not found on window');
            return;
        }

        // 7桁完全入力の場合は完全一致検索
        if (value.length === 7) {
            console.log('[SearchEngine] 7-digit zip, doing lookup');
            const result = postal.lookup(value);
            console.log('[SearchEngine] Lookup result:', result);
            if (result) {
                this.fillPostalData(input, result, true);
                this.hideSuggestions();
            }
            return;
        }

        // 3-6桁の場合は候補表示
        console.log('[SearchEngine] Partial zip, getting suggestions');
        const suggestions = postal.suggest(value, 50);
        console.log('[SearchEngine] Got', suggestions.length, 'suggestions');
        if (suggestions.length > 0) {
            this.renderPostalSuggestions(input, suggestions);
        } else {
            this.hideSuggestions();
        }
    }

    /**
     * 郵便番号候補をレンダリング
     */
    private renderPostalSuggestions(input: HTMLInputElement, suggestions: PostalRecord[]) {
        let html = '';

        suggestions.forEach(record => {
            const displayZip = record.zip.substring(0, 3) + '-' + record.zip.substring(3);
            const address = `${record.pref} ${record.city} ${record.town}`;
            const dataJson = escapeHtml(JSON.stringify(record));

            // Single line layout: zip code on left, address on right
            html += `<div class="suggestion-item postal-item" data-postal="${dataJson}" style="padding:6px 8px; cursor:pointer; border-bottom:1px solid #eee; font-size:14px; color:#333; display:flex; gap:12px; align-items:center;">
                <span style="color:#3b82f6; flex-shrink:0; min-width:85px;">${displayZip}</span>
                <span style="color:#666; flex-grow:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(address)}</span>
            </div>`;
        });

        const box = this.getGlobalBox();
        box.innerHTML = html;

        // Positioning
        const rect = input.getBoundingClientRect();
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

        box.style.width = Math.max(rect.width, 400) + 'px';
        box.style.left = (rect.left + scrollLeft) + 'px';
        box.style.top = (rect.bottom + scrollTop) + 'px';
        box.style.maxHeight = '360px';  // Enforce max height
        box.style.overflowY = 'auto';    // Enable scrolling

        // Hover effects
        box.querySelectorAll('.suggestion-item').forEach((el: any) => {
            el.onmouseenter = () => el.style.background = '#f0f8ff';
            el.onmouseleave = () => el.style.background = 'white';
        });

        box.style.display = 'block';
        this.suggestionsVisible = true;
    }

    /**
     * 郵便番号データを関連フィールドに自動入力
     */
    private fillPostalData(input: HTMLInputElement, record: PostalRecord, formatZip = false) {
        // 郵便番号フィールド自体を更新（ハイフン付き）
        if (formatZip) {
            input.value = record.zip.substring(0, 3) + '-' + record.zip.substring(3);
        }

        // 入力フィールドのグループ情報を解析
        const sourceField = parseFieldName(input);

        // グループがない場合は警告して処理中断
        if (!sourceField.group) {
            console.warn(
                '[fillPostalData] グループプレフィックスが必要です。フィールド名:', sourceField.raw,
                '例: sender.zip, sender_zip, sender-zip'
            );
            return;
        }

        console.log('[fillPostalData] Source field group:', sourceField.group,
            'separator:', sourceField.separator);

        // 同じ行または近隣のフィールドを検索（スコープ検出）
        // dynamic-rowがある場合はそれを優先、なければtableまたはformを使用
        const container = input.closest('.dynamic-row')
            || input.closest('.address-group')
            || input.closest('table')
            || input.closest('form')
            || input.closest('.form-row')?.parentElement
            || document;

        const containerType = container === document ? 'document' :
            input.closest('tr') ? 'tr' :
                input.closest('.dynamic-row') ? 'dynamic-row' :
                    input.closest('.address-group') ? 'address-group' :
                        input.closest('table') ? 'table' :
                            input.closest('form') ? 'form' : 'form-row';

        console.log('[fillPostalData] Container type:', containerType,
            'Source group:', sourceField.group);

        const allInputs = Array.from(container.querySelectorAll('input, select, textarea')) as HTMLInputElement[];

        // 同じグループのフィールドのみをフィルタリング
        const groupedFields = allInputs
            .map(inp => ({ element: inp, parsed: parseFieldName(inp) }))
            .filter(({ parsed }) => isSameGroup(sourceField, parsed));

        console.log('[fillPostalData] Found', groupedFields.length,
            'fields in same group:', sourceField.group);

        // タイプ別にフィールドを探して自動入力
        const fieldMap = new Map<string, HTMLInputElement>();

        for (const { element, parsed } of groupedFields) {
            if (element === input) continue; // 自分自身はスキップ

            const type = detectFieldType(parsed.fieldType || '');
            if (type && !fieldMap.has(type)) {
                fieldMap.set(type, element);
            }
        }

        // 都道府県フィールド
        const prefField = fieldMap.get('pref');
        if (prefField) {
            prefField.value = record.pref;
            prefField.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[fillPostalData] Filled pref:', prefField.dataset.jsonPath || prefField.name);
        }

        // 市区町村フィールド
        const cityField = fieldMap.get('city');
        if (cityField) {
            cityField.value = record.city;
            cityField.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[fillPostalData] Filled city:', cityField.dataset.jsonPath || cityField.name);
        }

        // 町字フィールド
        const townField = fieldMap.get('town');
        if (townField) {
            townField.value = record.town;
            townField.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[fillPostalData] Filled town:', townField.dataset.jsonPath || townField.name);
        }

        // 住所フィールド（個別フィールドで入力されていない部分のみ）
        const addressField = fieldMap.get('address');
        if (addressField) {
            let addressValue = '';
            if (!prefField && !cityField && !townField) {
                // 個別フィールドが全くない場合：完全な住所
                addressValue = `${record.pref}${record.city}${record.town}`;
            } else if (prefField && !cityField && !townField) {
                // prefのみがある場合：市区町村+町名
                addressValue = `${record.city}${record.town}`;
            } else if (!townField) {
                // pref/cityのいずれかがある場合：町名のみ
                addressValue = record.town;
            }
            // townがある場合は、addressには何も入れない

            if (addressValue) {
                addressField.value = addressValue;
                addressField.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('[fillPostalData] Filled address:', addressField.dataset.jsonPath || addressField.name, '=', addressValue);
            }
        }

        // フィールドが1つも見つからなかった場合の警告
        if (fieldMap.size === 0) {
            console.warn('[fillPostalData] 同じグループ内に住所フィールドが見つかりませんでした。グループ:', sourceField.group);
        }
    }

    private getGlobalBox(): HTMLElement {
        if (this.globalBox && !document.body.contains(this.globalBox)) {
            this.globalBox = null;
        }
        if (!this.globalBox) {
            this.globalBox = document.getElementById('web-a-search-suggestions');
            if (!this.globalBox) {
                this.globalBox = document.createElement('div');
                this.globalBox.id = 'web-a-search-suggestions';
                this.globalBox.className = 'search-suggestions';
                Object.assign(this.globalBox.style, {
                    display: 'none',
                    position: 'absolute',
                    background: 'white',
                    border: '1px solid #ccc',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    zIndex: '9999',
                    borderRadius: '4px'
                });
                document.body.appendChild(this.globalBox);
            }
        }
        return this.globalBox;
    }

    private hideSuggestions() {
        const box = this.getGlobalBox();
        if (box) box.style.display = 'none';
        this.suggestionsVisible = false;
        this.activeSearchInput = null;
    }

    private setupEventDelegation() {
        console.log('[SearchEngine] Setting up event delegation');

        // Close on click outside
        document.addEventListener('click', (e: any) => {
            if (this.suggestionsVisible && !e.target.closest('#web-a-search-suggestions') && e.target !== this.activeSearchInput) {
                this.hideSuggestions();
            }
        });

        // Close on scroll
        document.addEventListener('scroll', () => {
            if (this.suggestionsVisible) this.hideSuggestions();
        }, true);

        // Input Event
        document.body.addEventListener('input', (e: any) => {
            console.log('[SearchEngine] Input event on:', e.target.tagName, 'classList:', e.target.classList.value);
            if (e.target.classList.contains('search-input')) {
                console.log('[SearchEngine] Target has search-input class, handling');
                this.handleSearchInput(e.target as HTMLInputElement);
            } else {
                console.log('[SearchEngine] Target does not have search-input class, ignoring');
            }
        });

        // Click Event (Selection)
        document.body.addEventListener('click', (e: any) => {
            const target = e.target as HTMLElement | null;
            const suggestion = target?.closest?.('.suggestion-item') as HTMLElement | null;
            if (suggestion) {
                this.handleSelection(suggestion);
            }
        });
    }

    private handleSearchInput(input: HTMLInputElement) {
        this.activeSearchInput = input;
        const w = window as any;

        console.log('[SearchEngine] handleSearchInput called for:', input.dataset.jsonPath || input.name, 'value:', input.value);

        // Note: Postal handling moved to runtime.ts global listener for better datalist integration
        if (this.isPostalField(input)) {
            console.log('[SearchEngine] Detected as postal field, calling handlePostalInput');
            this.handlePostalInput(input);
            return;
        }

        const srcKey = input.dataset.masterSrc;
        const suggestSource = input.dataset.suggestSource;
        if (!srcKey && !suggestSource) return;

        const labelIdx = this.toIndex(input.dataset.masterLabelIndex);
        const valueIdx = this.toIndex(input.dataset.masterValueIndex);

        const query = input.value;
        if (!query) {
            this.hideSuggestions();
            return;
        }

        const hits: any[] = [];
        const normQuery = this.normalize(query);

        if (suggestSource === 'column') {
            const baseKey = input.dataset.baseKey;
            const table = input.closest('table');
            if (table && baseKey) {
                const seen = new Set<string>();
                table.querySelectorAll(`[data-base-key="${baseKey}"]`).forEach((inp: any) => {
                    if (inp === input) return;
                    const v = inp.value;
                    if (v && this.normalize(v).includes(normQuery)) {
                        if (!seen.has(v)) {
                            seen.add(v);
                            hits.push({ val: v, row: [v], label: v, score: 10 });
                        }
                    }
                });
            }
        } else if (srcKey) {
            // Master Search
            console.log('[SearchEngine] Master search requested. srcKey:', srcKey);
            console.log('[SearchEngine] generatedJsonStructure exists?', !!w.generatedJsonStructure);
            if (w.generatedJsonStructure) {
                console.log('[SearchEngine] masterData exists?', !!w.generatedJsonStructure.masterData);
                if (w.generatedJsonStructure.masterData) {
                    console.log('[SearchEngine] Available master keys:', Object.keys(w.generatedJsonStructure.masterData));
                }
            }

            if (!w.generatedJsonStructure || !w.generatedJsonStructure.masterData) return;
            const master = w.generatedJsonStructure.masterData;
            if (!master[srcKey]) {
                console.log('[SearchEngine] Master key not found:', srcKey);
                return;
            }

            const allRows = master[srcKey];
            const seenVals = new Set<string>();

            allRows.forEach((row: string[], idx: number) => {
                if (idx === 0) return; // Skip header
                const match = row.some(col => this.normalize(col || '').includes(normQuery));
                if (match) {
                    const labelVal = labelIdx >= 0 ? row[labelIdx] || '' : '';
                    const valueVal = valueIdx >= 0 ? row[valueIdx] || '' : '';
                    const val = valueIdx >= 0 ? valueVal : (labelIdx >= 0 ? labelVal : (row[1] || row[0] || ''));

                    // Deduplicate based on val+label combination
                    const uniqueKey = val + '|' + labelVal;

                    if (!seenVals.has(uniqueKey)) {
                        seenVals.add(uniqueKey);
                        hits.push({ val, row, label: labelVal, score: 10, idx });
                    }
                }
            });
        }

        this.renderSuggestions(input, hits, labelIdx);
    }

    private renderSuggestions(input: HTMLInputElement, hits: any[], labelIdx: number) {
        if (hits.length === 0) {
            this.hideSuggestions();
            return;
        }

        // Basic sort: Currently simple score 10 for all. Could add advanced scoring later.

        const topHits = hits.slice(0, 10);
        let html = '';
        topHits.forEach(h => {
            const rowJson = escapeHtml(JSON.stringify(h.row));
            const displayLabel = labelIdx >= 0 ? (h.label || h.row.join(' : ')) : h.row.join(' : ');
            html += `<div class="suggestion-item" data-val="${escapeHtml(h.val)}" data-row="${rowJson}" style="padding:8px; cursor:pointer; border-bottom:1px solid #eee; font-size:14px; color:#333;">${escapeHtml(displayLabel)}</div>`;
        });

        const box = this.getGlobalBox();
        box.innerHTML = html;

        // Positioning (Simplified port)
        const rect = input.getBoundingClientRect();
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

        box.style.width = Math.max(rect.width, 200) + 'px';
        box.style.left = (rect.left + scrollLeft) + 'px';
        box.style.top = (rect.bottom + scrollTop) + 'px';
        box.style.maxHeight = '300px';  // Enforce max height for regular suggestions too
        box.style.overflowY = 'auto';    // Enable scrolling

        // Hover effects via JS
        box.querySelectorAll('.suggestion-item').forEach((el: any) => {
            el.onmouseenter = () => el.style.background = '#f0f8ff';
            el.onmouseleave = () => el.style.background = 'white';
        });

        box.style.display = 'block';
        this.suggestionsVisible = true;
    }

    private handleSelection(item: HTMLElement) {
        if (!this.activeSearchInput) return;

        // 郵便番号候補の選択
        if (item.classList.contains('postal-item')) {
            const postalJson = item.dataset.postal;
            if (postalJson) {
                try {
                    const record = JSON.parse(postalJson) as PostalRecord;
                    this.fillPostalData(this.activeSearchInput, record, true);
                } catch (e) {
                    console.error('Failed to parse postal data:', e);
                }
            }
            this.hideSuggestions();
            return;
        }

        // 既存のマスタデータ選択処理
        const w = window as any;
        const input = this.activeSearchInput;
        const val = item.dataset.val || '';
        const rowJson = item.dataset.row || '[]';

        // 1. Fill Input
        // Note: Full logic includes auto-mapping. For now, basic fill.
        // We need to implement the detailed auto-fill logic here or call a helper.
        // Let's implement the core auto-fill logic.

        try {
            const rowData = JSON.parse(rowJson);
            const srcKey = input.dataset.masterSrc;
            const masterHeaders = srcKey ? w.generatedJsonStructure.masterData[srcKey][0] : [];

            let searchInputFilled = false;

            if (masterHeaders.length > 0 && rowData.length > 0) {
                const tr = input.closest('tr');
                if (tr) {
                    const inputs = Array.from(tr.querySelectorAll('input, select, textarea'));
                    masterHeaders.forEach((header: string, idx: number) => {
                        if (!header) return;
                        const targetVal = rowData[idx];
                        // Find target input... (omitted full logic for brevity, will copy full logic if needed or improve)
                        // For refactoring, we should copy the ROBUST logic.
                        this.fillField(inputs, header, targetVal, input, () => { searchInputFilled = true; });
                    });
                }
            }

            if (!searchInputFilled) {
                input.value = val;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }

        } catch (e) { console.error(e); }

        // 2. Custom Autofill (via data-autofill attribute)
        // Format: "targetKey:sourceIndex" (e.g. "vendor_name:3")
        const autofillAttr = input.dataset.autofill;
        if (autofillAttr && !autofillAttr.startsWith('postal:') && !autofillAttr.startsWith('lg:')) {
            try {
                const rowData = JSON.parse(rowJson);
                const mappings = autofillAttr.split(',');
                mappings.forEach(mapping => {
                    const [targetKey, sourceIdxRaw] = mapping.split(':');
                    const sourceIdx = parseInt(sourceIdxRaw, 10);
                    if (targetKey && !isNaN(sourceIdx)) {
                        // 1-based index to 0-based
                        const val = rowData[sourceIdx - 1];
                        if (val !== undefined) {
                            this.fillFieldByKey(input, targetKey, val);
                        }
                    }
                });
            } catch (e) {
                console.warn('[SearchEngine] Autofill error:', e);
            }
        }

        this.hideSuggestions();
    }

    private fillFieldByKey(origin: HTMLInputElement, targetKey: string, value: string) {
        const container = origin.closest('tr') || origin.closest('.dynamic-row') || origin.closest('form') || document.body;
        const normKey = this.normalize(targetKey);

        const inputs = Array.from(container.querySelectorAll('input, select, textarea')) as HTMLInputElement[];
        const target = inputs.find(inp => {
            if (inp === origin) return false;
            const k = inp.dataset.jsonPath || inp.dataset.baseKey || inp.name || '';
            // Basic normalization for matching
            return k === targetKey || this.normalize(k) === normKey;
        });

        if (target) {
            console.log('[SearchEngine] Autofill target found:', targetKey, '->', value);
            target.value = value;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            // Trigger change for libraries that listen to change
            target.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            console.log('[SearchEngine] Autofill target NOT found:', targetKey);
        }

    }

    private fillField(inputs: any[], header: string, value: string, sourceInput: HTMLInputElement, onSelfFilled: () => void) {
        // Simplified mapping logic for now to verify module bundle works.
        // We will perform a strict copy of the logic in next step if this works.
        // Re-implementing the "Flexible Match" logic:
        const normHeader = this.normalize(header);

        const target = inputs.find((inp: any) => {
            const k = inp.dataset.baseKey || inp.dataset.jsonPath;
            const ph = this.normalize(inp.getAttribute('placeholder') || '');
            // Label matching is expensive to re-query DOM. 
            // Assume Key or Placeholder match for V1 refactor.
            return (k && this.normalize(k) === normHeader) || (ph === normHeader);
        });

        if (target) {
            target.value = value || '';
            target.dispatchEvent(new Event('input', { bubbles: true }));
            if (target === sourceInput) onSelfFilled();
        }
    }
}
