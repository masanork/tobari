import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { z } from 'zod';
import {
    FormDefinitionSchema,
    type FormDefinition,
    type FormElement,
    type TextField,
    type TextareaField,
    type IntegerField,
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
      max-width: 800px;
      margin: 0 auto;
      padding: 1rem;
      background: #fff;
      color: #333;
    }
    h1 { margin-bottom: 0.5rem; }
    .meta-info { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
    
    .field-group {
      margin-bottom: 1.5rem;
    }
    label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
    }
    input, select {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 1rem;
      box-sizing: border-box;
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
    
    button.submit-btn {
      background: #007bff;
      color: white;
      border: none;
      padding: 1rem 2rem;
      border-radius: 4px;
      font-size: 1rem;
      cursor: pointer;
      width: 100%;
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
        margin-bottom: 0;
        height: 100%;
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
  `;

    @property({ type: Object })
    definition: FormDefinition | null = null;

    @state()
    private formData: Record<string, any> = {};

    @state()
    private errors: Record<string, string> = {};

    @state()
    private suggestions: { path: string, items: any[] } | null = null;

    // Load definition from JSON object
    setSchema(schema: unknown) {
        try {
            this.definition = FormDefinitionSchema.parse(schema);
            // Initialize calculated fields
            this.updateCalculatedFields();
            this.requestUpdate();
        } catch (e) {
            console.error("Invalid Schema:", e);
            this.errors['global'] = "Invalid Form Schema";
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

    private renderTextField(field: TextField, path: string[], options: { noLabel?: boolean, rowIndex?: number } = {}) {
        // If field has a formula, get the calculated value from formData
        // (calculated values are updated by updateCalculatedFields)
        const val = this.getValue(path) || '';
        const pathStr = path.join('.');
        const hasSuggestions = this.suggestions && this.suggestions.path === pathStr && this.suggestions.items.length > 0;

        return html`
      <div class="field-group" style="position:relative;">
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
          ?readonly=${field.readonly || !!(field as any).formula}
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
      </div>
    `;
    }

    private renderTextareaField(field: TextareaField, path: string[], options: { noLabel?: boolean, rowIndex?: number } = {}) {
        const val = this.getValue(path) || '';
        return html`
      <div class="field-group">
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
          ?readonly=${field.readonly}
          rows=${field.rows || 3}
          style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem; box-sizing: border-box;"
        ></textarea>
        ${this.renderError(path)}
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

        const isReadonly = field.readonly || isAutonum || hasFormula;
        console.log(`renderIntegerField: ${field.key}, path: ${path.join('/')}, val: ${val}, readonly: ${isReadonly}, formula: ${hasFormula}, autonum: ${isAutonum}`);

        return html`
      <div class="field-group">
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
      </div>
    `;
    }

    private renderSelectField(field: SelectField, path: string[], options: { noLabel?: boolean, rowIndex?: number } = {}) {
        const val = this.getValue(path) || '';
        return html`
      <div class="field-group">
        ${options.noLabel ? nothing : html`<label>${field.label || field.key}</label>`}
        <select @change=${(e: Event) => this.handleInput(e, path)} .value=${val}>
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
      <div class="field-group">
        <div class="group-container">
          ${options.noLabel ? nothing : html`<span class="group-label">${field.label || field.key}</span>`}
          ${field.fields.map(child => this.renderField(child, [...path, child.key], { rowIndex: options.rowIndex }))}
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
        <div class="field-group">
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
                                    <button type="button" class="remove-btn" style="margin-top:0;" @click=${() => this.handleRemoveItem(path, index)}>
                                        ×
                                    </button>
                                </td>
                            </tr>
                        `)}
                    </tbody>
                </table>
                <div class="array-actions">
                    <button type="button" class="add-btn" @click=${() => this.handleAddItem(path, field.itemSchema)}>
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
        <div class="field-group">
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

    private renderField(field: FormElement, path: string[], options: { noLabel?: boolean, rowIndex?: number } = {}): any {
        // console.log(`renderField ${field.key} noLabel=${options.noLabel}`);
        switch (field.type) {
            case 'text': return this.renderTextField(field, path, options);
            case 'textarea': return this.renderTextareaField(field, path, options);
            case 'integer': return this.renderIntegerField(field, path, options);
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

        <form @submit=${(e: Event) => { e.preventDefault(); this.submit(); }}>
          ${this.definition.fields.map(field => this.renderField(field, [field.key]))}
          
          <button type="submit" class="submit-btn">Submit</button>
        </form>

        ${this.errors['global'] ? html`<div class="error-msg">${this.errors['global']}</div>` : ''}
      </div>
    `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'tobari-form': TobariForm;
    }
}
