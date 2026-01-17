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
      padding: 1rem;
      background: #fff;
      color: #333;
    }
    h1 { margin-bottom: 0.5rem; }
    .meta-info { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }

    /* 2-column grid layout for form fields */
    .form-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem 2rem;
    }

    .field-group {
      margin-bottom: 1rem;
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 0.5rem;
      align-items: center;
    }
    .field-group label {
      display: block;
      margin-bottom: 0;
      font-weight: 500;
      text-align: right;
      padding-right: 0.5rem;
      white-space: nowrap;
    }

    /* Full-width fields (textarea, array, static_table, group) */
    .field-group.full-width {
      grid-column: 1 / -1;
      grid-template-columns: 1fr;
    }
    .field-group.full-width label {
      text-align: left;
      padding-right: 0;
      margin-bottom: 0.5rem;
    }

    input, select {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 1rem;
      box-sizing: border-box;
    }

    /* Hide number input spinners */
    input[type="number"]::-webkit-inner-spin-button,
    input[type="number"]::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    input[type="number"] {
      -moz-appearance: textfield;
    }
    input:focus, select:focus {
      border-color: #007bff;
      outline: none;
      box-shadow: 0 0 0 2px rgba(0,123,255,0.25);
    }
    .error-msg {
      color: #d32f2f;
      font-size: 0.875rem;
      margin-top: 0.25rem;
    }
    .hint-text {
      color: #666;
      font-size: 0.875rem;
      margin-top: 0.25rem;
      font-style: italic;
    }

    /* Size classes for inputs */
    .field-size-S input, .field-size-S select {
      max-width: 150px;
    }
    .field-size-M input, .field-size-M select {
      max-width: 300px;
    }
    .field-size-L input, .field-size-L select {
      max-width: 600px;
    }
    .group-container {
      border: 1px solid #eee;
      padding: 1rem;
      border-radius: 8px;
    }
    .group-label {
      font-weight: bold;
      margin-bottom: 1rem;
      display: block;
      border-bottom: 1px solid #eee;
      padding-bottom: 0.5rem;
    }
    
    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      margin-top: 2rem;
    }
    .form-actions button {
      padding: 0.75rem 1.5rem;
      border-radius: 4px;
      font-size: 1rem;
      cursor: pointer;
      border: none;
      font-weight: 500;
    }
    button.clear-btn {
      background: #6c757d;
      color: white;
    }
    button.clear-btn:hover { background: #5a6268; }
    button.withdraw-btn {
      background: #6c757d;
      color: white;
    }
    button.withdraw-btn:hover { background: #5a6268; }
    button.reject-btn {
      background: #fd7e14;
      color: white;
    }
    button.reject-btn:hover { background: #e8590c; }
    button.save-btn {
      background: #28a745;
      color: white;
    }
    button.save-btn:hover { background: #218838; }
    button.submit-btn {
      background: #007bff;
      color: white;
    }
    button.submit-btn:hover { background: #0056b3; }

    .array-container {
        border: 1px solid #ddd;
        padding: 1rem;
        border-radius: 8px;
        background: #f9f9f9;
    }
    .array-item {
        border-left: 3px solid #007bff;
        padding-left: 1rem;
        margin-bottom: 1rem;
        position: relative;
    }
    .array-actions {
        margin-top: 0.5rem;
    }
    button.add-btn {
        background: #28a745;
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9rem;
    }
    button.remove-btn {
        background: #dc3545;
        color: white;
        border: none;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.8rem;
        margin-top: 0.5rem;
    }

    table.array-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 1rem;
        background-color: white;
        font-size: 0.9rem;
    }
    table.array-table th, table.array-table td {
        border: 1px solid #e0e0e0;
        padding: 0; /* Tight packing for inputs */
        vertical-align: top;
    }
    table.array-table th {
        background-color: #f8f9fa;
        text-align: left;
        padding: 10px;
        font-weight: 600;
        color: #333;
        white-space: nowrap;
    }
    /* First column in table body should not wrap (labels) */
    table.array-table tbody td:first-child {
        white-space: nowrap;
        padding: 10px;
    }
    table.array-table tr:nth-child(even) {
        background-color: #fafafa;
    }
    table.array-table tr:hover {
        background-color: #f0f7ff;
    }
    
    /* Inputs inside table cells */
    table.array-table input,
    table.array-table select,
    table.array-table textarea {
        border: 1px solid transparent;
        border-radius: 0;
        padding: 8px;
        background: transparent;
        width: 100%;
        height: 100%;
        box-shadow: none;
    }
    /* Number inputs should be narrower */
    table.array-table input[type="number"]:not([readonly]) {
        max-width: 120px;
    }
    /* Read-only number inputs (autonum, calculated) - compact width */
    table.array-table input[type="number"][readonly] {
        width: 80px;
    }
    table.array-table input:focus,
    table.array-table select:focus,
    table.array-table textarea:focus {
        border: 1px solid #007bff;
        background: white;
        outline: none;
        z-index: 1;
        position: relative;
    }
    table.array-table input[readonly],
    table.array-table textarea[readonly] {
        background-color: #f5f5f5;
        color: #555;
        cursor: not-allowed;
    }
    
    table.array-table .field-group {
        margin: 0;
        padding: 0;
        height: 100%;
        display: block;
        grid-template-columns: none;
        gap: 0;
    }
    table.array-table .field-group label {
        display: none !important;
    }
    
    .table-actions {
        text-align: center;
        vertical-align: middle !important;
        width: 40px;
        padding: 0 !important;
    }
    .table-actions button {
        margin: 4px;
        padding: 4px 8px;
    }

    .suggestions-box {
        position: absolute;
        background: white;
        border: 1px solid #ccc;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        z-index: 1000;
        border-radius: 4px;
        max-height: 200px;
        overflow-y: auto;
        width: 100%;
        margin-top: 2px;
    }
    .suggestion-item {
        padding: 8px;
        cursor: pointer;
        border-bottom: 1px solid #eee;
    }
    .suggestion-item:hover {
        background: #f0f8ff;
    }

    .action-history {
      margin-top: 2rem;
      border-top: 2px solid #ddd;
      padding-top: 1rem;
    }
    .action-history h3 {
      margin-bottom: 1rem;
      font-size: 1.1rem;
    }
    .history-item {
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      border-left: 4px solid #007bff;
      background: #f8f9fa;
      border-radius: 4px;
    }
    .history-item.withdrawn {
      border-left-color: #6c757d;
    }
    .history-item.rejected {
      border-left-color: #fd7e14;
    }
    .history-timestamp {
      font-size: 0.875rem;
      color: #666;
      margin-bottom: 0.25rem;
    }
    .history-action {
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .history-user {
      color: #333;
      margin-bottom: 0.25rem;
    }
    .history-reason {
      color: #555;
      font-style: italic;
    }

    .dialog-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    }
    .dialog-box {
      background: white;
      padding: 2rem;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      max-width: 500px;
      width: 90%;
    }
    .dialog-box h3 {
      margin-top: 0;
      margin-bottom: 1rem;
    }
    .dialog-box .field-group {
      margin-bottom: 1rem;
      display: block;
    }
    .dialog-box label {
      display: block;
      margin-bottom: 0.5rem;
      text-align: left;
    }
    .dialog-box input,
    .dialog-box textarea {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1.5rem;
    }
    .dialog-actions button {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .dialog-cancel {
      background: #6c757d;
      color: white;
    }
    .dialog-confirm {
      background: #007bff;
      color: white;
    }
  `;

    @property({ type: Object })
    definition: FormDefinition | null = null;

    @state()
    private formData: Record<string, any> = {};

    @state()
    private errors: Record<string, string> = {};

    @state()
    private suggestions: { path: string, items: any[] } | null = null;

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

    // Load definition from JSON object
    setSchema(schema: unknown, initialData?: any) {
        try {
            this.definition = FormDefinitionSchema.parse(schema);
            // Load initial data if provided (from embedded data in HTML)
            if (initialData) {
                if (initialData.formData) {
                    // New format with history
                    this.formData = initialData.formData;
                    this.isSubmitted = initialData.isSubmitted || false;
                    this.actionHistory = initialData.actionHistory || [];
                } else {
                    // Old format (just formData)
                    this.formData = initialData;
                }
                console.log('Loaded initial data from HTML');
            } else {
                // Try to restore from localStorage
                this.loadFromLocalStorage();
            }
            // Initialize calculated fields
            this.updateCalculatedFields();
            this.requestUpdate();
        } catch (e) {
            console.error("Invalid Schema:", e);
            this.errors['global'] = "Invalid Form Schema";
        }
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
                this.formData = data.formData || data; // Support old format
                this.isSubmitted = data.isSubmitted || false;
                this.actionHistory = data.actionHistory || [];
                console.log('Restored form data from localStorage');
            }
        } catch (e) {
            console.error('Failed to load from localStorage:', e);
        }
    }

    private saveToLocalStorage() {
        if (!this.definition) return;
        try {
            const key = this.getStorageKey();
            const data = {
                formData: this.formData,
                isSubmitted: this.isSubmitted,
                actionHistory: this.actionHistory
            };
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.error('Failed to save to localStorage:', e);
        }
    }

    private clearForm() {
        if (confirm('入力内容と履歴をすべてクリアしてよろしいですか？')) {
            this.formData = {};
            this.errors = {};
            this.isSubmitted = false;
            this.actionHistory = [];
            if (this.definition) {
                const key = this.getStorageKey();
                localStorage.removeItem(key);
            }
            this.requestUpdate();
        }
    }

    private confirmSubmit() {
        const user = prompt('担当者名を入力してください:');
        if (!user) return;

        if (confirm('確定します。よろしいですか？\n確定後は編集できなくなります。')) {
            this.isSubmitted = true;
            this.actionHistory.push({
                timestamp: new Date().toISOString(),
                action: 'submitted',
                user: user
            });
            this.saveToLocalStorage();
            this.requestUpdate();
        }
    }

    private withdrawSubmission() {
        this.pendingAction = 'withdrawn';
        this.showActionDialog = true;
        this.requestUpdate();
    }

    private rejectSubmission() {
        this.pendingAction = 'rejected';
        this.showActionDialog = true;
        this.requestUpdate();
    }

    private handleActionSubmit(e: Event) {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const formData = new FormData(form);
        const user = formData.get('user') as string;
        const reason = formData.get('reason') as string;

        if (!user || !reason) {
            alert('担当者名と理由を入力してください');
            return;
        }

        this.isSubmitted = false;
        this.actionHistory.push({
            timestamp: new Date().toISOString(),
            action: this.pendingAction!,
            user: user,
            reason: reason
        });

        this.showActionDialog = false;
        this.pendingAction = null;
        this.saveToLocalStorage();
        this.requestUpdate();
    }

    private cancelActionDialog() {
        this.showActionDialog = false;
        this.pendingAction = null;
        this.requestUpdate();
    }

    private downloadFormHTML() {
        // Clone current document and embed formData with history
        const htmlDoc = document.documentElement.outerHTML;

        const embeddedData = {
            formData: this.formData,
            isSubmitted: this.isSubmitted,
            actionHistory: this.actionHistory
        };

        // Build script tags using array join to avoid template literal issues
        const parts = [
            '\n    <script id="embedded-form-data" type="application/json">\n',
            JSON.stringify(embeddedData, null, 2),
            '\n    <',
            '/script>\n',
            '    <',
            'script>\n',
            '        window.addEventListener(\'DOMContentLoaded\', () => {\n',
            '            const embeddedDataElement = document.getElementById(\'embedded-form-data\');\n',
            '            if (embeddedDataElement) {\n',
            '                const data = JSON.parse(embeddedDataElement.textContent);\n',
            '                customElements.whenDefined(\'tobari-form\').then(() => {\n',
            '                    const form = document.querySelector(\'tobari-form\');\n',
            '                    if (form) {\n',
            '                        if (data.formData) {\n',
            '                            Object.assign(form.formData, data.formData);\n',
            '                        }\n',
            '                        if (data.isSubmitted !== undefined) {\n',
            '                            form.isSubmitted = data.isSubmitted;\n',
            '                        }\n',
            '                        if (data.actionHistory) {\n',
            '                            form.actionHistory = data.actionHistory;\n',
            '                        }\n',
            '                        form.requestUpdate();\n',
            '                    }\n',
            '                });\n',
            '            }\n',
            '        });\n',
            '    <',
            '/script>\n',
            '</body>'
        ];
        const formDataScript = parts.join('');

        const modifiedHTML = htmlDoc.replace('</body>', formDataScript);

        const blob = new Blob([modifiedHTML], { type: 'text/html; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = [this.definition?.meta.title || 'form', '-作業中-', timestamp, '.html'].join('');
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
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

    private handleSearchInput(e: Event, path: string[], masterSrc?: string) {
        this.handleInput(e, path);
        const input = e.target as HTMLInputElement;
        const value = input.value;

        if (!masterSrc || !this.definition?.masterData || !this.definition.masterData[masterSrc]) {
            this.suggestions = null;
            return;
        }

        if (value.length < 1) {
            this.suggestions = null;
            return;
        }

        const masterTable = this.definition.masterData[masterSrc];
        const normQuery = this.normalize(value);
        
        // Simple search: check if any column contains the query
        // Skip header (index 0)
        const hits = masterTable.slice(1).filter(row => 
            row.some(col => this.normalize(col).includes(normQuery))
        ).slice(0, 10); // Limit to 10

        if (hits.length > 0) {
            this.suggestions = { path: path.join('.'), items: hits };
        } else {
            this.suggestions = null;
        }
    }

    private handleSuggestionSelect(path: string[], row: string[], field: TextField) {
        // 1. Fill current field (default to first column or exact match logic if complex)
        // Indices are 1-based
        const valIdx = (field.masterValueIndex || 1) - 1;
        const primaryVal = row[valIdx] || row[0] || ''; 
        this.updateDataAtPath(this.formData, path, primaryVal);

        // 2. Autofill logic
        if (field.autofill) {
            const mappings = field.autofill.split(',');
            mappings.forEach(mapping => {
                const [targetKey, sourceIdxRaw] = mapping.split(':');
                const sourceIdx = parseInt(sourceIdxRaw, 10);
                if (targetKey && !isNaN(sourceIdx)) {
                    // sourceIdx is 1-based in v1 (usually)
                    const val = row[sourceIdx - 1];
                    if (val !== undefined) {
                        // We need to find the target path. 
                        // Simplified: assume target is sibling (same parent path).
                        const parentPath = path.slice(0, -1);
                        const targetPath = [...parentPath, targetKey];
                        this.updateDataAtPath(this.formData, targetPath, val);
                    }
                }
            });
        }
        
        this.suggestions = null;
        this.requestUpdate();
    }

    private handleInput(e: Event, path: string[]) {
        console.log('handleInput called, path:', path);
        const target = e.target as HTMLInputElement | HTMLSelectElement;
        let value: any = target.value;
        console.log('  value:', value, 'type:', target.type);

        if (target.type === 'number') {
            // For number inputs, convert empty string to 0 (not undefined)
            // This ensures formulas can calculate properly
            value = value === '' ? 0 : Number(value);
            console.log('  converted to:', value);
        }

        // Deep merge value into formData
        // For MVP, we stick to flat-ish keys or simple object structure.
        // Let's implement simple deep set based on path.
        this.updateDataAtPath(this.formData, path, value);
        console.log('  formData after update:', JSON.stringify(this.formData, null, 2));

        // Update calculated fields
        console.log('  calling updateCalculatedFields...');
        this.updateCalculatedFields();

        // Clear error for this field if exists
        const pathKey = path.join('.');
        if (this.errors[pathKey]) {
            const newErrors = { ...this.errors };
            delete newErrors[pathKey];
            this.errors = newErrors;
        }
        // Save to localStorage
        this.saveToLocalStorage();
        this.requestUpdate();
    }

    private handleAddItem(path: string[], itemSchema: FormElement) {
        console.log("handleAddItem called", path, itemSchema);
        let currentArray = this.getValue(path);
        if (!Array.isArray(currentArray)) {
            currentArray = [];
        }

        let newItem: any = undefined;
        if (itemSchema.type === 'group') {
            newItem = {};
        } else if (itemSchema.type === 'array') {
            newItem = [];
        }

        const newArray = [...currentArray, newItem];
        this.updateDataAtPath(this.formData, path, newArray);

        // Update calculated fields after adding new item
        this.updateCalculatedFields();
        // Save to localStorage
        this.saveToLocalStorage();

        this.requestUpdate();
    }

    private handleRemoveItem(path: string[], index: number) {
        const currentArray = this.getValue(path);
        if (Array.isArray(currentArray)) {
            const newArray = [...currentArray];
            newArray.splice(index, 1);
            this.updateDataAtPath(this.formData, path, newArray);
            // Update calculated fields after removing item
            this.updateCalculatedFields();
            // Save to localStorage
            this.saveToLocalStorage();
            this.requestUpdate();
        }
    }

    private updateDataAtPath(obj: any, path: string[], value: any) {
        let current = obj;
        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (!current[key]) current[key] = {};
            current = current[key];
        }
        current[path[path.length - 1]] = value;
    }

    private getValue(path: string[]): any {
        let current = this.formData;
        for (const key of path) {
            if (current === undefined) return undefined;
            current = current[key];
        }
        return current;
    }

    private updateCalculatedFields() {
        console.log('updateCalculatedFields called');
        if (!this.definition) {
            console.log('  no definition, returning');
            return;
        }

        // Update all formula fields in the schema
        const updateFieldsInList = (fields: FormElement[], basePath: string[]) => {
            console.log('  updateFieldsInList, basePath:', basePath, 'fields count:', fields.length);
            for (const field of fields) {
                const formula = (field as any).formula;
                if (formula) {
                    const fieldPath = [...basePath, field.key];
                    console.log(`    Found formula field: ${field.key}, formula: ${formula}, path:`, fieldPath);
                    const result = this.evaluateFormula(formula, fieldPath);
                    console.log(`    Result: ${result}`);
                    this.updateDataAtPath(this.formData, fieldPath, result);
                }

                // Recursively handle group fields
                if (field.type === 'group') {
                    updateFieldsInList((field as GroupField).fields, [...basePath, field.key]);
                }

                // Handle array fields
                if (field.type === 'array') {
                    const arrayPath = [...basePath, field.key];
                    const arrayData = this.getValue(arrayPath);
                    if (Array.isArray(arrayData)) {
                        const itemSchema = (field as ArrayField).itemSchema;
                        if (itemSchema.type === 'group') {
                            arrayData.forEach((_, index) => {
                                updateFieldsInList((itemSchema as GroupField).fields, [...arrayPath, index.toString()]);
                            });
                        }
                    }
                }

                // Handle static table fields
                if (field.type === 'static_table') {
                    const tablePath = [...basePath, field.key];
                    for (const row of (field as StaticTableField).rows) {
                        for (const cell of row) {
                            if (typeof cell !== 'string') {
                                const cellFormula = (cell as any).formula;
                                if (cellFormula) {
                                    const cellPath = [...tablePath, cell.key];
                                    const result = this.evaluateFormula(cellFormula, cellPath);
                                    this.updateDataAtPath(this.formData, cellPath, result);
                                }
                            }
                        }
                    }
                }
            }
        };

        updateFieldsInList(this.definition.fields, []);
    }

    private evaluateFormula(formula: string, path: string[]): number | string {
        try {
            // Handle SUM(fieldKey) function
            const sumMatch = formula.match(/^SUM\(([^)]+)\)$/);
            if (sumMatch) {
                const fieldKey = sumMatch[1];
                // Determine the array path - SUM can reference current array or a different array
                let arrayPath: string[];

                // Check if we're in a static_table context (path like ['tbl_xxx', 'fieldKey'])
                if (path.length === 2 && path[0].startsWith('tbl_')) {
                    // We're in a static table, need to find the array with the fieldKey
                    // Look for the array field in the form definition
                    const arrayField = this.definition?.fields.find(f =>
                        f.type === 'array' &&
                        (f as ArrayField).itemSchema.type === 'group' &&
                        ((f as ArrayField).itemSchema as GroupField).fields.some(gf => gf.key === fieldKey)
                    ) as ArrayField | undefined;

                    if (arrayField) {
                        arrayPath = [arrayField.key];
                    } else {
                        console.warn('Could not find array for SUM field:', fieldKey);
                        return 0;
                    }
                } else {
                    // Normal case: parent path is the array
                    arrayPath = path.slice(0, -1);
                }

                const arrayData = this.getValue(arrayPath);
                console.log(`SUM(${fieldKey}) - arrayPath:`, arrayPath, 'arrayData:', arrayData);

                if (Array.isArray(arrayData)) {
                    let sum = 0;
                    for (const item of arrayData) {
                        const value = item?.[fieldKey];
                        console.log(`  item[${fieldKey}] =`, value, typeof value);
                        if (typeof value === 'number') {
                            sum += value;
                        } else if (typeof value === 'string' && !isNaN(Number(value))) {
                            sum += Number(value);
                        } else if (value === undefined || value === null || value === '') {
                            // Treat as 0
                            sum += 0;
                        }
                    }
                    console.log(`  sum = ${sum}`);
                    return sum;
                }
                console.log('  not an array, returning 0');
                return 0;
            }

            // Handle simple arithmetic expressions like "a + b - c"
            // Extract variable names
            const variables = formula.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];

            // Get parent context path (remove last element which is the calc field key)
            const contextPath = path.slice(0, -1);
            console.log(`Formula: ${formula}, path:`, path, 'contextPath:', contextPath);

            // Replace variables with their values
            let expression = formula;
            for (const varName of variables) {
                const varPath = [...contextPath, varName];
                let value = this.getValue(varPath);
                console.log(`  ${varName} (${varPath.join('/')}) =`, value);

                // Convert to number, default to 0 if undefined/null
                if (value === undefined || value === null || value === '') {
                    value = 0;
                } else if (typeof value === 'string') {
                    value = Number(value) || 0;
                }

                // Replace all occurrences of the variable
                expression = expression.replace(new RegExp(`\\b${varName}\\b`, 'g'), String(value));
            }

            console.log(`  expression: ${expression}`);

            // Evaluate the expression safely
            // Only allow numbers, operators, and parentheses
            if (!/^[\d\s+\-*/().]+$/.test(expression)) {
                console.error('Invalid expression:', expression);
                return 'Error: Invalid formula';
            }

            const result = eval(expression);
            console.log(`  result: ${result}`);
            return typeof result === 'number' ? result : 0;
        } catch (e) {
            console.error('Formula evaluation error:', e, 'Formula:', formula);
            return 'Error';
        }
    }

    private buildDataSchema(definition: FormDefinition): z.ZodType<any> {
        const shape: Record<string, z.ZodType<any>> = {};
        for (const field of definition.fields) {
            shape[field.key] = this.buildFieldSchema(field);
        }
        return z.object(shape);
    }

    private async performSignAndDownload() {
        if (!this.definition) return;
        
        try {
            // 1. Validate
            const schema = this.buildDataSchema(this.definition);
            const validData = schema.parse(this.formData);

            // 2. Generate temporary key for signing (Demo purposes)
            // In real world, this would use a key from a wallet or secure storage
            const keyPair = await window.crypto.subtle.generateKey(
                { name: "ECDSA", namedCurve: "P-256" },
                true,
                ["sign", "verify"]
            );

            // 3. Serialize Data (Simple JSON for now, can be CBOR)
            const payload = JSON.stringify({
                data: validData,
                meta: this.definition.meta,
                timestamp: new Date().toISOString()
            });
            const encoder = new TextEncoder();
            const payloadBytes = encoder.encode(payload);

            // 4. Sign
            const signature = await window.crypto.subtle.sign(
                { name: "ECDSA", hash: { name: "SHA-256" } },
                keyPair.privateKey,
                payloadBytes
            );

            // 5. Package as a "Tobari Submission" file
            const submission = {
                payload: validData,
                signature: btoa(String.fromCharCode(...new Uint8Array(signature))),
                publicKey: await window.crypto.subtle.exportKey("jwk", keyPair.publicKey)
            };

            const blob = new Blob([JSON.stringify(submission, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.definition.meta.title}-submission.json`;
            a.click();
            URL.revokeObjectURL(url);

            alert("署名が完了し、申請ファイルがダウンロードされました。");
        } catch (e) {
            console.error("Signing failed:", e);
            alert("署名に失敗しました。バリデーションエラーがないか確認してください。");
        }
    }

    private buildDataSchema(definition: FormDefinition): z.ZodType<any> {
        const shape: Record<string, z.ZodType<any>> = {};
        for (const field of definition.fields) {
            shape[field.key] = this.buildFieldSchema(field);
        }
        return z.object(shape);
    }

    private buildFieldSchema(field: FormElement): z.ZodType<any> {
        let s: z.ZodType<any>;
        
        switch (field.type) {
            case 'text':
            case 'textarea':
                s = z.string();
                if (field.minLength) s = (s as z.ZodString).min(field.minLength);
                if (field.maxLength) s = (s as z.ZodString).max(field.maxLength);
                // textarea usually doesn't have pattern validation in schema but we can add it if schema supports
                if (field.type === 'text' && field.pattern) s = (s as z.ZodString).regex(new RegExp(field.pattern));
                break;
            case 'integer':
                s = z.number();
                if (field.min !== undefined) s = (s as z.ZodNumber).min(field.min);
                if (field.max !== undefined) s = (s as z.ZodNumber).max(field.max);
                break;
            case 'select':
                const values = field.options.map(o => o[0]) as [string, ...string[]];
                if (values.length > 0) {
                     s = z.enum(values);
                } else {
                     s = z.string();
                }
                break;
            case 'group':
                const groupShape: Record<string, z.ZodType<any>> = {};
                for (const sub of field.fields) {
                    groupShape[sub.key] = this.buildFieldSchema(sub);
                }
                s = z.object(groupShape);
                break;
            case 'array':
                s = z.array(this.buildFieldSchema(field.itemSchema));
                if (field.minItems) s = (s as z.ZodArray<any>).min(field.minItems);
                if (field.maxItems) s = (s as z.ZodArray<any>).max(field.maxItems);
                break;
            case 'static_table':
                const tableShape: Record<string, z.ZodType<any>> = {};
                for (const row of field.rows) {
                    for (const cell of row) {
                        if (typeof cell !== 'string') {
                            tableShape[cell.key] = this.buildFieldSchema(cell);
                        }
                    }
                }
                s = z.object(tableShape);
                break;
            default:
                s = z.any();
        }

        if (!field.required) {
            s = s.optional();
        } else {
            // If required, ensure text is not empty
            if (field.type === 'text' || field.type === 'textarea') {
                s = (s as z.ZodString).min(1, "Required");
            }
        }
        
        return s;
    }

    private submit() {
        if (!this.definition) return;
        this.errors = {}; // Clear errors
        
        try {
            const schema = this.buildDataSchema(this.definition);
            const validData = schema.parse(this.formData);
            
            console.log("Submitting:", validData);
            const event = new CustomEvent('tobari-submit', {
                detail: { data: validData },
                bubbles: true,
                composed: true
            });
            this.dispatchEvent(event);
        } catch (e) {
            if (e instanceof z.ZodError) {
                console.error("Validation Error:", e.errors);
                const newErrors: Record<string, string> = {};
                for (const issue of e.errors) {
                    const pathKey = issue.path.join('.');
                    newErrors[pathKey] = issue.message;
                }
                this.errors = newErrors;
                this.requestUpdate();
            }
        }
    }

    // --- Renderers ---

    private renderError(path: string[]) {
        const error = this.errors[path.join('.')];
        return error ? html`<div class="error-msg">${error}</div>` : nothing;
    }

    private renderHint(field: any, options?: { noLabel?: boolean }) {
        // Don't show hints in table cells (when noLabel is true)
        if (options?.noLabel) return nothing;
        const hint = field.hint;
        return hint ? html`<div class="hint-text">${unsafeHTML(hint)}</div>` : nothing;
    }

    private renderTextField(field: TextField, path: string[], options: { noLabel?: boolean, rowIndex?: number } = {}) {
        // If field has a formula, get the calculated value from formData
        // (calculated values are updated by updateCalculatedFields)
        const val = this.getValue(path) || '';
        const pathStr = path.join('.');
        const hasSuggestions = this.suggestions && this.suggestions.path === pathStr && this.suggestions.items.length > 0;

        const sizeClass = (field as any).size ? `field-size-${(field as any).size}` : '';
        return html`
      <div class="field-group ${sizeClass}" style="position:relative;">
        ${options.noLabel ? nothing : html`
        <label>
          ${field.label || field.key}
          ${field.required ? '*' : ''}
        </label>`}
        <input
          type="text"
          .value=${val}
          @input=${(e: Event) => field.masterSrc ? this.handleSearchInput(e, path, field.masterSrc) : this.handleInput(e, path)}
          placeholder=${field.placeholder || ''}
          ?required=${field.required}
          ?readonly=${field.readonly || !!(field as any).formula || this.isSubmitted}
          minlength=${field.minLength || nothing}
          maxlength=${field.maxLength || nothing}
          pattern=${field.pattern || nothing}
          @blur=${() => setTimeout(() => { if(this.suggestions?.path === pathStr) this.suggestions = null; }, 200)}
        >
        ${hasSuggestions ? html`
            <div class="suggestions-box">
                ${this.suggestions!.items.map(row => {
                    const labelIdx = (field.masterLabelIndex || 1) - 1;
                    const valIdx = (field.masterValueIndex || 1) - 1;
                    const label = row[labelIdx] || row.join(' | ');
                    // Optional: show value if different? For now just label is fine
                    return html`
                    <div class="suggestion-item" @click=${() => this.handleSuggestionSelect(path, row, field)}>
                        ${label}
                    </div>
                `})}
            </div>
        ` : nothing}
        ${this.renderError(path)}
        ${this.renderHint(field, options)}
      </div>
    `;
    }

    private renderTextareaField(field: TextareaField, path: string[], options: { noLabel?: boolean, rowIndex?: number } = {}) {
        const val = this.getValue(path) || '';
        return html`
      <div class="field-group full-width">
        ${options.noLabel ? nothing : html`
        <label>
          ${field.label || field.key}
          ${field.required ? '*' : ''}
        </label>`}
        <textarea
          .value=${val}
          @input=${(e: Event) => this.handleInput(e, path)}
          placeholder=${field.placeholder || ''}
          ?required=${field.required}
          ?readonly=${field.readonly || this.isSubmitted}
          rows=${field.rows || 3}
          style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem; box-sizing: border-box;"
        ></textarea>
        ${this.renderError(path)}
        ${this.renderHint(field, options)}
      </div>
    `;
    }

    private renderIntegerField(field: IntegerField, path: string[], options: { noLabel?: boolean, rowIndex?: number } = {}) {
        // For autonum fields, use rowIndex + 1 as the value
        const isAutonum = (field as any).autonum === true;
        const hasFormula = !!(field as any).formula;
        // If field has a formula, get the calculated value from formData
        // For autonum, use row index
        const val = isAutonum && options.rowIndex !== undefined
            ? options.rowIndex + 1
            : this.getValue(path) ?? '';

        const isReadonly = field.readonly || isAutonum || hasFormula || this.isSubmitted;
        console.log(`renderIntegerField: ${field.key}, path: ${path.join('/')}, val: ${val}, readonly: ${isReadonly}, formula: ${hasFormula}, autonum: ${isAutonum}`);

        const sizeClass = (field as any).size ? `field-size-${(field as any).size}` : '';
        return html`
      <div class="field-group ${sizeClass}">
        ${options.noLabel ? nothing : html`
        <label>
          ${field.label || field.key}
          ${field.required ? '*' : ''}
        </label>`}
        <input
          type="number"
          .value=${val}
          @input=${(e: Event) => { console.log('input event fired!', path); this.handleInput(e, path); }}
          @change=${(e: Event) => { console.log('change event fired!', path); this.handleInput(e, path); }}
          min=${field.min || nothing}
          max=${field.max || nothing}
          step=${field.step}
          ?required=${field.required}
          ?readonly=${isReadonly}
          data-field-key=${field.key}
        >
        ${this.renderError(path)}
        ${this.renderHint(field, options)}
      </div>
    `;
    }

    private renderDateField(field: DateField, path: string[], options: { noLabel?: boolean, rowIndex?: number } = {}) {
        const val = this.getValue(path) || '';
        const sizeClass = (field as any).size ? `field-size-${(field as any).size}` : '';
        return html`
      <div class="field-group ${sizeClass}">
        ${options.noLabel ? nothing : html`
        <label>
          ${field.label || field.key}
          ${field.required ? '*' : ''}
        </label>`}
        <input
          type="date"
          .value=${val}
          @input=${(e: Event) => this.handleInput(e, path)}
          min=${field.min || nothing}
          max=${field.max || nothing}
          ?required=${field.required}
          ?readonly=${field.readonly || this.isSubmitted}
        >
        ${this.renderError(path)}
        ${this.renderHint(field, options)}
      </div>
    `;
    }

    private renderSelectField(field: SelectField, path: string[], options: { noLabel?: boolean, rowIndex?: number } = {}) {
        const val = this.getValue(path) || '';
        return html`
      <div class="field-group">
        ${options.noLabel ? nothing : html`<label>${field.label || field.key}</label>`}
        <select @change=${(e: Event) => this.handleInput(e, path)} .value=${val} ?disabled=${this.isSubmitted}>
          <option value="" disabled ?selected=${!val}>Select...</option>
          ${field.options.map(([optVal, optLabel]) => html`
            <option value=${optVal} ?selected=${val === optVal}>${optLabel}</option>
          `)}
        </select>
        ${this.renderError(path)}
      </div>
    `;
    }

    private renderGroupField(field: GroupField, path: string[], options: { noLabel?: boolean, rowIndex?: number } = {}) {
        return html`
      <div class="field-group full-width">
        <div class="group-container">
          ${options.noLabel ? nothing : html`<span class="group-label">${field.label || field.key}</span>`}
          ${field.fields.map(child => this.renderField(child, [...path, child.key], { rowIndex: options.rowIndex, noLabel: options.noLabel }))}
        </div>
        ${this.renderError(path)}
      </div>
    `;
    }

    private renderArrayField(field: ArrayField, path: string[]) {
        const items = this.getValue(path) || [];
        const arrayItems = Array.isArray(items) ? items : [];
        const isGroup = field.itemSchema.type === 'group';
        const columns = isGroup ? (field.itemSchema as GroupField).fields : [field.itemSchema];

        return html`
        <div class="field-group full-width">
            <label>${field.label || field.key}</label>
            <div class="array-container" style="padding:0; border:none; background:transparent;">
                <table class="array-table">
                    <thead>
                        <tr>
                            ${columns.map(col => html`<th>${col.label || col.key} ${col.required ? '*' : ''}</th>`)}
                            <th class="table-actions"></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${arrayItems.map((_, index) => html`
                            <tr>
                                ${columns.map(col => html`
                                    <td>
                                        ${this.renderField(col, [...path, index.toString(), ...(isGroup ? [col.key] : [])], { noLabel: true, rowIndex: index })}
                                    </td>
                                `)}
                                <td class="table-actions">
                                    <button type="button" class="remove-btn" style="margin-top:0;" @click=${() => this.handleRemoveItem(path, index)} ?disabled=${this.isSubmitted}>
                                        ×
                                    </button>
                                </td>
                            </tr>
                        `)}
                    </tbody>
                </table>
                <div class="array-actions">
                    <button type="button" class="add-btn" @click=${() => this.handleAddItem(path, field.itemSchema)} ?disabled=${this.isSubmitted}>
                        + Add Item
                    </button>
                </div>
            </div>
            ${this.renderError(path)}
        </div>
        `;
    }

    private renderStaticTableField(field: StaticTableField, path: string[]) {
        return html`
        <div class="field-group full-width">
            <label>${field.label || field.key}</label>
            <div class="array-container" style="padding:0; border:none; background:transparent;">
                <table class="array-table">
                    <thead>
                        <tr>
                            ${field.headers.map(header => html`<th>${header}</th>`)}
                        </tr>
                    </thead>
                    <tbody>
                        ${field.rows.map((row, rowIndex) => html`
                            <tr>
                                ${row.map((cell, colIndex) => html`
                                    <td>
                                        ${typeof cell === 'string' 
                                            ? cell 
                                            : this.renderField(cell, [...path, cell.key], { noLabel: true })}
                                    </td>
                                `)}
                            </tr>
                        `)}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    }

    private renderActionDialog() {
        if (!this.showActionDialog || !this.pendingAction) return nothing;

        const actionLabel = this.pendingAction === 'withdrawn' ? '取下' : '差戻';

        return html`
            <div class="dialog-overlay">
                <div class="dialog-box">
                    <h3>${actionLabel}</h3>
                    <form @submit=${this.handleActionSubmit}>
                        <div class="field-group">
                            <label>担当者名 *</label>
                            <input type="text" name="user" required />
                        </div>
                        <div class="field-group">
                            <label>理由 *</label>
                            <textarea name="reason" rows="4" required></textarea>
                        </div>
                        <div class="dialog-actions">
                            <button type="button" class="dialog-cancel" @click=${() => this.cancelActionDialog()}>キャンセル</button>
                            <button type="submit" class="dialog-confirm">${actionLabel}</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    private renderActionHistory() {
        if (this.actionHistory.length === 0) return nothing;

        const getActionLabel = (action: string) => {
            switch (action) {
                case 'submitted': return '確定';
                case 'withdrawn': return '取下';
                case 'rejected': return '差戻';
                default: return action;
            }
        };

        return html`
            <div class="action-history">
                <h3>操作履歴</h3>
                ${this.actionHistory.map(item => html`
                    <div class="history-item ${item.action}">
                        <div class="history-timestamp">${new Date(item.timestamp).toLocaleString('ja-JP')}</div>
                        <div class="history-action">${getActionLabel(item.action)}</div>
                        <div class="history-user">担当者: ${item.user}</div>
                        ${item.reason ? html`<div class="history-reason">理由: ${item.reason}</div>` : nothing}
                    </div>
                `)}
            </div>
        `;
    }

    private renderField(field: FormElement, path: string[], options: { noLabel?: boolean, rowIndex?: number } = {}): any {
        // console.log(`renderField ${field.key} noLabel=${options.noLabel}`);
        switch (field.type) {
            case 'text': return this.renderTextField(field, path, options);
            case 'textarea': return this.renderTextareaField(field, path, options);
            case 'integer': return this.renderIntegerField(field, path, options);
            case 'date': return this.renderDateField(field, path, options);
            case 'select': return this.renderSelectField(field, path, options);
            case 'group': return this.renderGroupField(field, path, options);
            case 'array': return this.renderArrayField(field, path); // array doesn't use noLabel usually
            case 'static_table': return this.renderStaticTableField(field, path);
            default:
                return html`<div class="error-msg">Unknown field type: ${(field as any).type}</div>`;
        }
    }

    render() {
        if (!this.definition) {
            return html`<div>No Schema Loaded</div>`;
        }

        return html`
      <div class="tobari-form">
        <header>
          <h1>${this.definition.meta.title}</h1>
          <div class="meta-info">
            Version: ${this.definition.meta.version} |
            Security: ${this.definition.meta.security}
          </div>
        </header>

        <form @submit=${(e: Event) => { e.preventDefault(); this.confirmSubmit(); }}>
          <div class="form-fields">
            ${this.definition.fields.map(field => this.renderField(field, [field.key]))}
          </div>

          ${this.isSubmitted ? html`
            <div class="form-actions">
              <button type="button" class="withdraw-btn" @click=${() => this.withdrawSubmission()}>取下</button>
              <button type="button" class="reject-btn" @click=${() => this.rejectSubmission()}>差戻</button>
            </div>
          ` : html`
            <div class="form-actions">
              <button type="button" class="clear-btn" @click=${() => this.clearForm()}>クリア</button>
              <button type="button" class="save-btn" @click=${() => this.downloadFormHTML()}>作業を保存</button>
              <button type="button" class="submit-btn" style="background:#28a745" @click=${() => this.performSignAndDownload()}>署名して提出</button>
              <button type="submit" class="submit-btn">確定(審査用)</button>
            </div>
          `}
        </form>

        ${this.renderActionHistory()}

        ${this.errors['global'] ? html`<div class="error-msg">${this.errors['global']}</div>` : ''}
      </div>

      ${this.renderActionDialog()}
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'tobari-form': TobariForm;
    }
}
