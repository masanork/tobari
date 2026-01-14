/**
 * Validation Dialog System
 * Shows confirmation dialog when user tries to submit incomplete form
 */

export interface ValidationResult {
    isValid: boolean;
    missingFields: Array<{
        key: string;
        label: string;
        type: string;
    }>;
}

export interface DialogOptions {
    missingFields: Array<{
        key: string;
        label: string;
        type: string;
    }>;
    onCancel: () => void;
    onSubmit: () => void;
}

export class ValidationDialog {
    private overlay: HTMLElement | null = null;

    /**
     * Show validation warning dialog
     */
    public show(options: DialogOptions): void {
        // Remove existing dialog if any
        this.close();

        const { missingFields, onCancel, onSubmit } = options;

        // Determine language
        const isJa = (navigator.language || '').toLowerCase().startsWith('ja');

        // Build missing fields list
        const fieldsList = missingFields.map(f =>
            `<li>${this.escapeHtml(f.label || f.key)}</li>`
        ).join('');

        // i18n messages
        const messages = isJa ? {
            title: '未入力の項目があります',
            message: '以下の必須項目が入力されていません。このまま提出しますか？',
            missingLabel: '未入力の項目：',
            cancelBtn: '戻る',
            submitBtn: '提出する'
        } : {
            title: 'Incomplete Required Fields',
            message: 'The following required fields are not filled. Do you want to submit anyway?',
            missingLabel: 'Missing fields:',
            cancelBtn: 'Go Back',
            submitBtn: 'Submit Anyway'
        };

        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'validation-dialog-overlay';
        this.overlay.innerHTML = `
            <div class="validation-dialog">
                <div class="validation-dialog-title">${this.escapeHtml(messages.title)}</div>
                <div class="validation-dialog-message">${this.escapeHtml(messages.message)}</div>
                <div class="validation-missing-fields">
                    <strong>${this.escapeHtml(messages.missingLabel)}</strong>
                    <ul>${fieldsList}</ul>
                </div>
                <div class="validation-dialog-actions">
                    <button class="validation-dialog-btn validation-dialog-btn-cancel" data-action="dialog-cancel">
                        ${this.escapeHtml(messages.cancelBtn)}
                    </button>
                    <button class="validation-dialog-btn validation-dialog-btn-submit" data-action="dialog-submit">
                        ${this.escapeHtml(messages.submitBtn)}
                    </button>
                </div>
            </div>
        `;

        // Event handlers
        const cancelBtn = this.overlay.querySelector('[data-action="dialog-cancel"]') as HTMLButtonElement;
        const submitBtn = this.overlay.querySelector('[data-action="dialog-submit"]') as HTMLButtonElement;

        cancelBtn?.addEventListener('click', () => {
            this.close();
            onCancel();
        });

        submitBtn?.addEventListener('click', () => {
            this.close();
            onSubmit();
        });

        // Close on overlay click (outside dialog)
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close();
                onCancel();
            }
        });

        // Close on ESC key
        const escHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.close();
                onCancel();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // Add to DOM
        document.body.appendChild(this.overlay);
    }

    /**
     * Close and remove dialog
     */
    public close(): void {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }

    /**
     * HTML escape utility
     */
    private escapeHtml(str: string): string {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

/**
 * Check required fields and return validation result
 */
export function checkRequiredFields(): ValidationResult {
    const w = window as any;
    const structure = w.generatedJsonStructure;

    if (!structure || !structure.fields) {
        return { isValid: true, missingFields: [] };
    }

    const missingFields: Array<{key: string; label: string; type: string}> = [];
    const inputs = Array.from(document.querySelectorAll('input, select, textarea')) as HTMLInputElement[];

    for (const input of inputs) {
        // Skip hidden inputs (by show_if logic or CSS)
        if (input.offsetParent === null) continue;
        if (input.disabled) continue;

        const key = input.dataset.jsonPath || input.name;
        if (!key) continue;

        const fieldDef = structure.fields.find((f: any) => f.key === key);
        if (fieldDef && fieldDef.required) {
            let isEmpty = false;

            if (input.type === 'checkbox') {
                isEmpty = !input.checked;
            } else if (input.type === 'radio') {
                const group = document.getElementsByName(input.name);
                let checked = false;
                for (let i = 0; i < group.length; i++) {
                    if ((group[i] as HTMLInputElement).checked) {
                        checked = true;
                        break;
                    }
                }
                isEmpty = !checked;
            } else {
                isEmpty = !input.value.trim();
            }

            if (isEmpty && !missingFields.find(f => f.key === key)) {
                missingFields.push({
                    key,
                    label: fieldDef.label || key,
                    type: fieldDef.type || 'text'
                });
            }
        }
    }

    return {
        isValid: missingFields.length === 0,
        missingFields
    };
}
