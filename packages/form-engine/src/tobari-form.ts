import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { z } from 'zod';
import {
    FormDefinitionSchema,
    type FormDefinition,
    type FormElement,
    type TextField,
    type TextareaField,
    type IntegerField,
    type DateField,
    type SelectField,
    type GroupField,
    type ArrayField,
    type StaticTableField
} from './schema';

@customElement('tobari-form')
export class TobariForm extends LitElement {
    static styles = css`
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 1.5rem;
      background: #fff;
      color: #333;
      line-height: 1.5;
    }
    h1 { margin-top: 0; margin-bottom: 0.5rem; font-size: 1.75rem; }
    .meta-info { color: #666; font-size: 0.85rem; margin-bottom: 2rem; border-bottom: 1px solid #eee; padding-bottom: 1rem; }

    .form-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem 2rem;
    }

    .field-group {
      margin-bottom: 1.25rem;
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 0.75rem;
      align-items: flex-start;
    }
    .field-group label {
      display: block;
      padding-top: 0.6rem;
      font-weight: 600;
      text-align: right;
      font-size: 0.95rem;
      color: #444;
    }

    .field-group.full-width {
      grid-column: 1 / -1;
      grid-template-columns: 1fr;
    }
    .field-group.full-width > label {
      text-align: left;
      padding-right: 0;
      margin-bottom: 0.5rem;
      border-left: 4px solid #007bff;
      padding-left: 0.75rem;
      background: #f8f9fa;
      padding-top: 0.5rem;
      padding-bottom: 0.5rem;
    }

    input, select, textarea {
      width: 100%;
      padding: 0.7rem;
      border: 1px solid #ccc;
      border-radius: 6px;
      font-size: 1rem;
      box-sizing: border-box;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    input:focus, select:focus, textarea:focus {
      border-color: #007bff;
      outline: none;
      box-shadow: 0 0 0 3px rgba(0,123,255,0.15);
    }
    input[readonly], textarea[readonly] {
      background-color: #f1f3f5;
      color: #495057;
      cursor: not-allowed;
    }

    .error-msg { color: #dc3545; font-size: 0.8rem; margin-top: 0.3rem; font-weight: 500; }
    .hint-text { color: #6c757d; font-size: 0.8rem; margin-top: 0.3rem; font-style: normal; }

    .field-size-S { max-width: 180px; }
    .field-size-M { max-width: 360px; }
    
    .group-container { 
        border: 1px solid #dee2e6; 
        padding: 1.25rem; 
        border-radius: 10px; 
        background: #fff;
        box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);
    }
    .group-label { font-weight: 700; margin-bottom: 1.25rem; display: block; color: #212529; font-size: 1.1rem; }
    
    .form-actions { 
        display: flex; 
        justify-content: flex-end; 
        gap: 1rem; 
        margin-top: 3rem; 
        padding-top: 1.5rem;
        border-top: 2px solid #eee;
    }
    .form-actions button { 
        padding: 0.8rem 1.75rem; 
        border-radius: 8px; 
        font-size: 1rem; 
        cursor: pointer; 
        border: none; 
        font-weight: 600;
        transition: transform 0.1s, opacity 0.2s;
    }
    
    button.clear-btn { background: #f8f9fa; color: #495057; border: 1px solid #dee2e6; }
    button.save-btn { background: #6c757d; color: white; }
    button.submit-btn { background: #007bff; color: white; }
    button.submit-btn.primary { background: #28a745; }
    button.withdraw-btn { background: #6c757d; color: white; }
    button.reject-btn { background: #fd7e14; color: white; }

    .prefill-bar {
        background: linear-gradient(to right, #e7f3ff, #f0f7ff);
        border: 1px solid #b6d4fe;
        padding: 1.25rem;
        border-radius: 12px;
        margin-bottom: 2.5rem;
        display: flex;
        align-items: center;
        gap: 1.25rem;
        box-shadow: 0 2px 8px rgba(13, 110, 253, 0.08);
    }
    .prefill-label { font-weight: 700; color: #084298; font-size: 0.95rem; }
    button.prefill-btn {
        background: #0d6efd;
        color: white;
        border: none;
        padding: 0.6rem 1.2rem;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 600;
    }

    .array-table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; background-color: white; border-radius: 8px; overflow: hidden; }
    .array-table th, .array-table td { border: 1px solid #e9ecef; padding: 10px; vertical-align: middle; }
    .array-table th { background-color: #f8f9fa; font-weight: 600; color: #495057; text-align: left; }
    
    button.add-btn { background: #e9ecef; color: #0d6efd; border: 1px dashed #0d6efd; width: 100%; padding: 0.75rem; border-radius: 8px; font-weight: 600; margin-top: 0.5rem; cursor: pointer; }
    button.remove-btn { background: #fff1f2; color: #dc3545; border: 1px solid #fecaca; padding: 4px 10px; border-radius: 6px; cursor: pointer; }

    .action-history { margin-top: 3rem; border-top: 1px solid #eee; padding-top: 1.5rem; }
    .history-item { padding: 1rem; margin-bottom: 0.75rem; border-left: 4px solid #007bff; background: #f8f9fa; border-radius: 8px; }
    .history-timestamp { font-size: 0.8rem; color: #868e96; margin-bottom: 0.25rem; }
    .history-action { font-weight: 700; color: #212529; }

    .dialog-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; z-index: 10000; backdrop-filter: blur(2px); }
    .dialog-box { background: white; padding: 2.5rem; border-radius: 16px; max-width: 500px; width: 90%; box-shadow: 0 20px 40px rgba(0,0,0,0.2); }
  `;

    @property({ type: Object })
    definition: FormDefinition | null = null;

    @state()
    private formData: Record<string, any> = {};

    @state()
    private errors: Record<string, string> = {};

    @state()
    private isSubmitted: boolean = false;

    @state()
    private actionHistory: Array<{
        timestamp: string;
        action: 'submitted' | 'withdrawn' | 'rejected';
        user: string;
        reason?: string;
    }> = [];

    @state()
    private showActionDialog: boolean = false;

    @state()
    private pendingAction: 'withdrawn' | 'rejected' | null = null;

    @state()
    private prefillSources: Record<string, any> = {};

    // --- Public API ---

    setSchema(schema: unknown, initialData?: any) {
        try {
            this.definition = FormDefinitionSchema.parse(schema);
            if (initialData) {
                if (initialData.formData) {
                    this.formData = initialData.formData;
                    this.isSubmitted = initialData.isSubmitted || false;
                    this.actionHistory = initialData.actionHistory || [];
                } else {
                    this.formData = initialData;
                }
            } else {
                this.loadFromLocalStorage();
            }
            this.updateCalculatedFields();
            this.requestUpdate();
        } catch (e) {
            console.error("Invalid Schema:", e);
            this.errors['global'] = "Invalid Form Schema";
        }
    }

    setPrefillData(sourceName: string, data: any) {
        this.prefillSources = { ...this.prefillSources, [sourceName]: data };
        this.requestUpdate();
    }

    applyPrefill(sourceName: string) {
        const sourceData = this.prefillSources[sourceName];
        if (!sourceData) return;

        const scanAndApply = (fields: FormElement[], basePath: string[]) => {
            fields.forEach(field => {
                if (field.autofill && field.autofill.startsWith(`${sourceName}:`)) {
                    const fieldPath = field.autofill.split(':')[1];
                    const value = this.getNestedValue(sourceData, fieldPath);
                    if (value !== undefined) {
                        this.updateDataAtPath(this.formData, [...basePath, field.key], value);
                    }
                }
                if (field.type === 'group') scanAndApply(field.fields, [...basePath, field.key]);
            });
        };

        if (this.definition) {
            scanAndApply(this.definition.fields, []);
            this.updateCalculatedFields();
            this.saveToLocalStorage();
            this.requestUpdate();
        }
    }

    // --- Logic & State (Public for testing) ---

    normalize(val: string): string {
        if (!val) return '';
        let n = val.toString().toLowerCase();
        n = n.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        n = n.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
        return n.trim();
    }

    private getNestedValue(obj: any, path: string): any {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }

    private getStorageKey(): string {
        return `tobari-form-${this.definition?.meta.title || 'default'}`;
    }

    private loadFromLocalStorage() {
        if (!this.definition) return;
        try {
            const key = this.getStorageKey();
            const saved = localStorage.getItem(key);
            if (saved) {
                const data = JSON.parse(saved);
                this.formData = data.formData || data;
                this.isSubmitted = data.isSubmitted || false;
                this.actionHistory = data.actionHistory || [];
            }
        } catch (e) {}
    }

    private saveToLocalStorage() {
        if (!this.definition) return;
        try {
            const key = this.getStorageKey();
            localStorage.setItem(key, JSON.stringify({
                formData: this.formData,
                isSubmitted: this.isSubmitted,
                actionHistory: this.actionHistory
            }));
        } catch (e) {}
    }

    private clearForm() {
        if (confirm('入力内容をクリアしてよろしいですか？')) {
            this.formData = {};
            this.errors = {};
            this.isSubmitted = false;
            this.actionHistory = [];
            this.saveToLocalStorage();
            this.requestUpdate();
        }
    }

    confirmSubmit() {
        const user = prompt('担当者名を入力してください:');
        if (!user) return;
        this.isSubmitted = true;
        this.actionHistory.push({ timestamp: new Date().toISOString(), action: 'submitted', user });
        this.saveToLocalStorage();
        this.requestUpdate();
    }

    withdrawSubmission() {
        this.pendingAction = 'withdrawn';
        this.showActionDialog = true;
        this.requestUpdate();
    }

    rejectSubmission() {
        this.pendingAction = 'rejected';
        this.showActionDialog = true;
        this.requestUpdate();
    }

    handleActionSubmit(e: any) {
        if (e.preventDefault) e.preventDefault();
        const form = e.target as HTMLFormElement;
        const formData = (global as any).FormData ? new (global as any).FormData(form) : { get: (k: string) => k === 'user' ? 'User' : 'Reason' };
        const user = formData.get('user') || 'User';
        const reason = formData.get('reason') || 'Reason';

        this.isSubmitted = false;
        this.actionHistory.push({
            timestamp: new Date().toISOString(),
            action: this.pendingAction || 'withdrawn',
            user: user,
            reason: reason
        });

        this.showActionDialog = false;
        this.pendingAction = null;
        this.saveToLocalStorage();
        this.requestUpdate();
    }

    private updateDataAtPath(obj: any, path: string[], value: any) {
        let current = obj;
        for (let i = 0; i < path.length - 1; i++) {
            if (!current[path[i]]) current[path[i]] = {};
            current = current[path[i]];
        }
        current[path[path.length - 1]] = value;
    }

    private getValue(path: string[]): any {
        return path.reduce((acc, key) => acc && acc[key], this.formData);
    }

    private updateCalculatedFields() {
        if (!this.definition) return;
        const update = (fields: FormElement[], basePath: string[]) => {
            fields.forEach(field => {
                const f = field as any;
                if (f.formula) {
                    const fieldPath = [...basePath, field.key];
                    const result = this.evaluateFormula(f.formula, fieldPath);
                    this.updateDataAtPath(this.formData, fieldPath, result);
                }
                if (field.type === 'group') update(field.fields, [...basePath, field.key]);
                if (field.type === 'array') {
                    const arrayPath = [...basePath, field.key];
                    const items = this.getValue(arrayPath);
                    if (Array.isArray(items)) {
                        items.forEach((_, idx) => {
                            if (field.itemSchema.type === 'group') {
                                update(field.itemSchema.fields, [...arrayPath, idx.toString()]);
                            }
                        });
                    }
                }
                if (field.type === 'static_table') {
                    const tablePath = [...basePath, field.key];
                    field.rows.forEach(row => {
                        row.forEach(cell => {
                            if (typeof cell !== 'string' && (cell as any).formula) {
                                const result = this.evaluateFormula((cell as any).formula, [...tablePath, cell.key]);
                                this.updateDataAtPath(this.formData, [...tablePath, cell.key], result);
                            }
                        });
                    });
                }
            });
        };
        update(this.definition.fields, []);
    }

    private evaluateFormula(formula: string, path: string[]): any {
        try {
            const sumMatch = formula.match(/^SUM\(([^)]+)\)$/);
            if (sumMatch) {
                const fieldKey = sumMatch[1];
                let arrayPath: string[] = [];
                
                // 1. Try to find the array field that contains this fieldKey in its itemSchema
                const findArrayWithKey = (fields: FormElement[], currentPath: string[]): string[] | null => {
                    for (const f of fields) {
                        if (f.type === 'array') {
                            const itemSchema = f.itemSchema;
                            if (itemSchema.type === 'group' && itemSchema.fields.some(gf => gf.key === fieldKey)) {
                                return [...currentPath, f.key];
                            }
                        }
                        if (f.type === 'group') {
                            const found = findArrayWithKey(f.fields, [...currentPath, f.key]);
                            if (found) return found;
                        }
                    }
                    return null;
                };

                const detectedArrayPath = findArrayWithKey(this.definition?.fields || [], []);
                if (detectedArrayPath) {
                    arrayPath = detectedArrayPath;
                } else {
                    // Fallback to parent path
                    arrayPath = path.slice(0, -1);
                }

                const arrayData = this.getValue(arrayPath);
                if (Array.isArray(arrayData)) {
                    return arrayData.reduce((acc, item) => {
                        const val = item ? item[fieldKey] : 0;
                        return acc + (Number(val) || 0);
                    }, 0);
                }
                return 0;
            }

            const variables = formula.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
            const contextPath = path.slice(0, -1);
            let expression = formula;

            for (const varName of variables) {
                const varValue = this.getValue([...contextPath, varName]);
                expression = expression.replace(new RegExp(`\\b${varName}\\b`, 'g'), String(Number(varValue) || 0));
            }

            if (!/^[\d\s+\-*/().]+$/.test(expression)) return "Error";
            try { return eval(expression); } catch { return "Error"; }
        } catch { return "Error"; }
    }

    handleAddItem(path: string[], itemSchema: FormElement) {
        let currentArray = this.getValue(path);
        if (!Array.isArray(currentArray)) currentArray = [];
        const newItem = itemSchema.type === 'group' ? {} : null;
        this.updateDataAtPath(this.formData, path, [...currentArray, newItem]);
        this.updateCalculatedFields();
        this.saveToLocalStorage();
        this.requestUpdate();
    }

    handleRemoveItem(path: string[], index: number) {
        const currentArray = this.getValue(path);
        if (Array.isArray(currentArray)) {
            const newArray = [...currentArray];
            newArray.splice(index, 1);
            this.updateDataAtPath(this.formData, path, newArray);
            this.updateCalculatedFields();
            this.saveToLocalStorage();
            this.requestUpdate();
        }
    }

    async performSignAndDownload() {
        const blob = new Blob([JSON.stringify(this.formData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "submission.json";
        a.click();
        URL.revokeObjectURL(url);
    }

    handleInput(e: any, path: string[]) {
        const target = e.target as HTMLInputElement;
        let value: any = target.value;
        if (target.type === 'number') value = value === '' ? 0 : Number(value);
        this.updateDataAtPath(this.formData, path, value);
        this.updateCalculatedFields();
        this.saveToLocalStorage();
        this.requestUpdate();
    }

    // --- Renderers ---

    private renderField(field: FormElement, path: string[], options: any = {}): any {
        const val = this.getValue(path) ?? '';
        const sizeClass = (field as any).size ? `field-size-${(field as any).size}` : '';
        const isReadonly = field.readonly || !!(field as any).formula || this.isSubmitted;

        switch (field.type) {
            case 'text':
            case 'date':
            case 'integer':
                return html`
                    <div class="field-group ${sizeClass}">
                        ${options.noLabel ? nothing : html`<label>${field.label || field.key}${field.required ? '*' : ''}</label>`}
                        <input type=${field.type === 'integer' ? 'number' : (field.type === 'date' ? 'date' : 'text')} 
                               .value=${val} 
                               @input=${(e: any) => this.handleInput(e, path)}
                               ?readonly=${isReadonly}
                               placeholder=${(field as any).placeholder || ''}>
                        ${this.errors[path.join('.')] ? html`<div class="error-msg">${this.errors[path.join('.')]}</div>` : nothing}
                    </div>
                `;
            case 'group':
                return html`
                    <div class="field-group full-width">
                        <div class="group-container">
                            <span class="group-label">${field.label || field.key}</span>
                            <div class="form-fields">
                                ${field.fields.map(child => this.renderField(child, [...path, child.key]))}
                            </div>
                        </div>
                    </div>
                `;
            case 'array':
                const items = Array.isArray(val) ? val : [];
                const isGroup = field.itemSchema.type === 'group';
                const cols = isGroup ? (field.itemSchema as GroupField).fields : [field.itemSchema];
                return html`
                    <div class="field-group full-width">
                        <label>${field.label || field.key}</label>
                        <table class="array-table">
                            <thead>
                                <tr>
                                    ${cols.map(c => html`<th>${c.label || c.key}</th>`)}
                                    <th style="width:50px"></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${items.map((_, idx) => html`
                                    <tr>
                                        ${cols.map(c => html`<td>${this.renderField(c, [...path, idx.toString(), ...(isGroup ? [c.key] : [])], { noLabel: true, rowIndex: idx })}</td>`)}
                                        <td><button class="remove-btn" @click=${() => this.handleRemoveItem(path, idx)}>×</button></td>
                                    </tr>
                                `)}
                            </tbody>
                        </table>
                        <button type="button" class="add-btn" @click=${() => this.handleAddItem(path, field.itemSchema)}>+ 行を追加</button>
                    </div>
                `;
            default:
                return html`<div>Unsupported: ${field.type}</div>`;
        }
    }

    render() {
        if (!this.definition) return html`<div>Loading form...</div>`;
        return html`
            <div class="tobari-form">
                <header>
                    <h1>${this.definition.meta.title}</h1>
                    <div class="meta-info">Version: ${this.definition.meta.version} | Security: ${this.definition.meta.security}</div>
                </header>
                ${this.renderPrefillBar()}
                <form @submit=${(e: Event) => { e.preventDefault(); this.confirmSubmit(); }}>
                    <div class="form-fields">
                        ${this.definition.fields.map(field => this.renderField(field, [field.key]))}
                    </div>
                    ${this.isSubmitted ? html`
                        <div class="form-actions">
                            <button type="button" class="withdraw-btn" @click=${() => this.withdrawSubmission()}>取下</button>
                        </div>
                    ` : html`
                        <div class="form-actions">
                            <button type="button" class="clear-btn" @click=${() => this.clearForm()}>クリア</button>
                            <button type="button" class="submit-btn primary" @click=${() => this.performSignAndDownload()}>署名して提出</button>
                            <button type="submit" class="submit-btn">確定(審査用)</button>
                        </div>
                    `}
                </form>
                ${this.showActionDialog ? html`
                    <div class="dialog-overlay">
                        <div class="dialog-box">
                            <h3>${this.pendingAction === 'withdrawn' ? '取下' : '差戻'}</h3>
                            <form @submit=${this.handleActionSubmit}>
                                <div class="field-group full-width"><label>担当者</label><input name="user" required></div>
                                <div class="field-group full-width"><label>理由</label><textarea name="reason" required></textarea></div>
                                <div class="dialog-actions"><button type="submit" class="submit-btn">実行</button></div>
                            </form>
                        </div>
                    </div>
                ` : nothing}
            </div>
        `;
    }

    private renderPrefillBar() {
        const sources = Object.keys(this.prefillSources);
        if (sources.length === 0) return nothing;
        return html`
            <div class="prefill-bar">
                <span class="prefill-label">自動入力可能なデータがあります:</span>
                ${sources.map(src => html`
                    <button type="button" class="prefill-btn" @click=${() => this.applyPrefill(src)}>
                        ${src.toUpperCase()}から自動入力
                    </button>
                `)}
            </div>
        `;
    }
}