
import { Calculator } from './calculator';
import { DataManager } from './data';

export class UIManager {
    private calc: Calculator;
    private data: DataManager;

    constructor(calc: Calculator, data: DataManager) {
        this.calc = calc;
        this.data = data;
        this.initSecuritySignal();
    }

    private initSecuritySignal() {
        window.addEventListener('weba-security-tier-change', (e: any) => {
            this.updateSecurityBadge(e.detail.tier);
        });
    }

    private updateSecurityBadge(tier: 'high' | 'standard' | 'offline') {
        const el = document.getElementById('weba-security-signal');
        if (!el) return;

        const isJa = (navigator.language || '').toLowerCase().startsWith('ja');
        const labels: Record<string, string> = {
            high: isJa ? "セキュリティ: 最高 (True PFS)" : "Security: HIGH (True PFS)",
            standard: isJa ? "セキュリティ: 標準 (Epoch-Based)" : "Security: STANDARD (Epoch)",
            offline: isJa ? "セキュリティ: 最小 (Offline/Static)" : "Security: BASIC (Offline)"
        };

        el.textContent = labels[tier];
        el.className = `security-badge tier-${tier}`;

        // Add visual indicator (dot)
        const dot = document.createElement('span');
        dot.className = 'status-dot';
        el.prepend(dot);
    }

    public applyI18n() {
        const RESOURCES: any = {
            "en": {
                "add_row": "+ Add Row",
                "work_save_btn": "Save Draft",
                "clear_btn": "Clear",
                "sign_btn": "Confirm",
                "withdraw_btn": "Withdraw",
                "return_btn": "Return",
            },
            "ja": {
                "add_row": "+ 行を追加",
                "work_save_btn": "下書き保存",
                "clear_btn": "消去",
                "sign_btn": "確定",
                "withdraw_btn": "取下",
                "return_btn": "差戻",
            }
        };
        const lang = (navigator.language || 'en').startsWith('ja') ? 'ja' : 'en';
        const dict = RESOURCES[lang] || RESOURCES['en'];

        document.querySelectorAll('[data-i18n]').forEach((el: any) => {
            const key = el.dataset.i18n;
            if (dict[key]) el.textContent = dict[key];
        });
    }

    /**
     * 電話番号フォーマッター
     * - 表示：ハイフン付き（090-1234-5678）
     * - JSON保存：数字のみ（09012345678）
     */
    public initTelFormatter() {
        document.querySelectorAll('input[type="tel"]').forEach((input: any) => {
            // データ読み込み時：数字のみ → ハイフン付きで表示
            if (input.value) {
                input.value = this.formatTelDisplay(input.value);
            }

            // 入力時：自動フォーマット
            input.addEventListener('input', (e: any) => {
                const cursorPos = e.target.selectionStart;
                const oldValue = e.target.value;
                const digitsOnly = oldValue.replace(/[^0-9]/g, '');
                const formatted = this.formatTelDisplay(digitsOnly);

                if (formatted !== oldValue) {
                    e.target.value = formatted;
                    // カーソル位置を調整（ハイフン挿入後も適切な位置に）
                    const diff = formatted.length - oldValue.length;
                    e.target.setSelectionRange(cursorPos + diff, cursorPos + diff);
                }
            });

            // blur時：データ保存用に数字のみに変換
            input.addEventListener('blur', (e: any) => {
                const digitsOnly = e.target.value.replace(/[^0-9]/g, '');
                // data-json-path に保存する値は数字のみ
                input.dataset.cleanValue = digitsOnly;
            });
        });
    }

    /**
     * 電話番号を表示用にフォーマット（ハイフン挿入）
     */
    private formatTelDisplay(tel: string): string {
        const digits = tel.replace(/[^0-9]/g, '');

        if (digits.length === 0) return '';

        // 11桁（携帯電話）: 090-1234-5678
        if (digits.length === 11 && digits.startsWith('0')) {
            return digits.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
        }
        // 10桁（固定電話）: 03-1234-5678 or 012-345-6789
        else if (digits.length === 10 && digits.startsWith('0')) {
            if (digits.startsWith('0120') || digits.startsWith('0800')) {
                // フリーダイヤル: 0120-123-456
                return digits.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1-$2-$3');
            } else if (['03', '04', '06'].includes(digits.substring(0, 2))) {
                // 東京・横浜・大阪など: 03-1234-5678
                return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '$1-$2-$3');
            } else {
                // その他: 012-345-6789
                return digits.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
            }
        }
        // フォーマットできない場合はそのまま返す
        return digits;
    }

    public initTables() {
        // Supports standard table structures and div-based structures with .dynamic-container
        document.querySelectorAll('.data-table.dynamic tbody, .dynamic-container').forEach((container) => {
            this.renumberRows(container as HTMLElement);
        });
    }

    private renumberRows(container: HTMLElement) {
        // Find rows: tr for tables, or .dynamic-row for divs
        let rows = Array.from(container.querySelectorAll('tr'));
        if (rows.length === 0) {
            rows = Array.from(container.querySelectorAll('.dynamic-row'));
        }

        // Filter out header/template if needed (simplified check)
        const validRows = rows.filter(row => {
            // If it's a table row, check for cells. If div, assume it's a row.
            return row.tagName !== 'TR' || row.querySelectorAll('td').length > 0;
        });

        validRows.forEach((row, index) => {
            const num = index + 1;
            row.querySelectorAll('.auto-num').forEach((input: any) => {
                if (input.value != num) {
                    input.value = num.toString();
                    // trigger change for any listeners
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
        });
    }

    public removeTableRow(btn: any) {
        const row = btn.closest('tr') || btn.closest('.dynamic-row');
        if (!row) return;

        const container = row.parentElement as HTMLElement;
        if (row.classList.contains('template-row')) {
            // Cannot delete template row, just clear inputs
            row.querySelectorAll('input').forEach((inp: HTMLInputElement) => {
                if (inp.type === 'checkbox') inp.checked = false;
                else inp.value = '';
            });
        } else {
            row.remove();
            if (container) this.renumberRows(container);
            this.calc.recalculate();
            this.data.updateJsonLd();
        }
    }

    public addTableRow(btn: any, tableKey: string) {
        const table = document.getElementById('tbl_' + tableKey);
        if (!table) return;
        // Support tbody or just the container itself
        const container = table.querySelector('tbody') || table;
        if (!container) return;

        const templateRow = container.querySelector('.template-row');
        if (!templateRow) return;

        const newRow = templateRow.cloneNode(true) as HTMLElement;
        newRow.classList.remove('template-row');

        // Reset inputs to default value (from attribute) or empty
        newRow.querySelectorAll('input').forEach(input => {
            if ((input as HTMLInputElement).type === 'checkbox') {
                (input as HTMLInputElement).checked = input.hasAttribute('checked');
            } else {
                (input as HTMLInputElement).value = input.getAttribute('value') || '';
            }
        });

        // Unhide delete button for non-template rows
        const rmBtn = newRow.querySelector('.remove-row-btn') as HTMLElement;
        if (rmBtn) rmBtn.style.visibility = 'visible';

        // Initialize Auto-Copy
        newRow.querySelectorAll('[data-copy-from]').forEach((target: any) => {
            const srcKey = target.dataset.copyFrom;
            if (srcKey) {
                const src = newRow.querySelector(`[data-base-key="${srcKey}"]`) as HTMLInputElement;
                if (src && src.value) {
                    target.value = src.value;
                }
            }
        });

        container.appendChild(newRow);

        this.renumberRows(container as HTMLElement);
        this.calc.recalculate();
    }

    public switchTab(btn: any, tabId: string) {
        document.querySelectorAll('.tab-btn').forEach((b: any) => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c: any) => c.classList.remove('active'));

        btn.classList.add('active');
        const content = document.getElementById(tabId);
        if (content) content.classList.add('active');
    }

    public updateVisibility() {
        document.querySelectorAll<HTMLElement>('[data-show-if]').forEach(el => {
            const condition = el.dataset.showIf;
            if (!condition) return;

            // Simple parser: key operator value OR just key (truthy)
            const match = condition.match(/^([a-zA-Z0-9_]+)\s*(==|!=)\s*(['"]?)(.*?)\3$/);
            const key = match ? match[1] : condition.trim();
            const op = match ? match[2] : null;
            const value = match ? match[4] : null;

            // Find input element: Prioritize local scope (same row) then global
            const row = el.closest('tr') || el.closest('.dynamic-row');
            let targetInput = (row ? row.querySelector(`[data-json-path="${key}"], [data-base-key="${key}"]`) : null) as HTMLInputElement | HTMLSelectElement;
            
            if (!targetInput) {
                targetInput = document.querySelector(`[data-json-path="${key}"]`) as HTMLInputElement | HTMLSelectElement;
            }

            let visible = false;

            if (targetInput) {
                let val = targetInput.value;
                
                if (targetInput.type === 'checkbox') {
                    val = (targetInput as HTMLInputElement).checked ? 'true' : 'false';
                } else if (targetInput.type === 'radio') {
                    const name = targetInput.name;
                    const scope = targetInput.closest('tr') || targetInput.closest('.dynamic-row') || document;
                    const checked = scope.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement;
                    val = checked ? checked.value : '';
                }

                if (op === '==') {
                    visible = val == value;
                } else if (op === '!=') {
                    visible = val != value;
                } else {
                    // Truthy check
                    if (targetInput.type === 'checkbox') {
                        visible = (targetInput as HTMLInputElement).checked;
                    } else {
                        visible = !!val && val !== 'false';
                    }
                }
            }

            // Toggle visibility
            const container = el.closest('.form-row') as HTMLElement;
            if (container) {
                container.style.display = visible ? '' : 'none';
                const inputs = container.querySelectorAll('input, select, textarea');
                inputs.forEach((inp: any) => {
                    inp.disabled = !visible;
                });
            } else {
                el.style.display = visible ? '' : 'none';
                if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
                    (el as any).disabled = !visible;
                }
            }
        });
    }
}
