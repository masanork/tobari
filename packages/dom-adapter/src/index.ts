import { FormEngine } from '@tobari/engine';
import type { FormDefinition, FieldDefinition } from '@tobari/schema';

export class TobariDOMAdapter {
    private engine: FormEngine;
    private container: HTMLElement;

    constructor(schema: FormDefinition, containerId: string, initialValues: any = {}) {
        this.engine = new FormEngine(schema, initialValues);
        const element = document.getElementById(containerId);
        if (!element) throw new Error(`Container #${containerId} not found`);
        this.container = element;

        this.init();
    }

    private init() {
        this.render();
        this.engine.subscribe((state: any) => {
            this.updateUI(state);
        });
    }

    private render() {
        this.container.innerHTML = '';
        const formEl = document.createElement('form');
        formEl.onsubmit = (e) => { e.preventDefault(); this.engine.validate(); };

        // Title
        // @ts-ignore - Accessing private schema for PoC
        const schema = this.engine['schema'] as FormDefinition;

        if (schema.title) {
            const title = document.createElement('h1');
            title.textContent = schema.title;
            formEl.appendChild(title);
        }

        // Fields
        schema.fields.forEach(field => {
            formEl.appendChild(this.createFieldElement(field));
        });

        // Submit
        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.textContent = 'Submit';
        formEl.appendChild(submitBtn);

        this.container.appendChild(formEl);
    }

    private createFieldElement(field: FieldDefinition, parentPath?: string, index?: number): HTMLElement {
        const fieldPath = parentPath !== undefined && index !== undefined
            ? `${parentPath}.${index}.${field.id}`
            : field.id;

        const wrapper = document.createElement('div');
        wrapper.className = 'tobari-field';
        wrapper.dataset.fieldPath = fieldPath;

        // Table Handling
        if (field.type === 'table') {
            const title = document.createElement('h3');
            title.textContent = field.label;
            wrapper.appendChild(title);

            const tableContainer = document.createElement('div');
            tableContainer.className = 'tobari-table';

            // Render rows based on current value length
            const rows = this.engine.getValue(fieldPath) || [];
            if (Array.isArray(rows)) {
                rows.forEach((_, rowIndex) => {
                    const rowWrapper = document.createElement('div');
                    rowWrapper.className = 'tobari-table-row';
                    rowWrapper.style.border = '1px solid #555';
                    rowWrapper.style.margin = '10px 0';
                    rowWrapper.style.padding = '10px';

                    // Row Label
                    const rowLabel = document.createElement('div');
                    rowLabel.textContent = `#${rowIndex + 1}`;
                    rowLabel.style.fontWeight = 'bold';
                    rowWrapper.appendChild(rowLabel);

                    field.columns?.forEach(col => {
                        rowWrapper.appendChild(this.createFieldElement(col, field.id, rowIndex));
                    });
                    tableContainer.appendChild(rowWrapper);
                });
            }
            wrapper.appendChild(tableContainer);
            return wrapper;
        }

        // Label
        const label = document.createElement('label');
        label.htmlFor = fieldPath;
        label.textContent = field.label;
        if (field.required) label.textContent += ' *';
        wrapper.appendChild(label);

        // Input
        let input: HTMLInputElement | HTMLSelectElement;

        if (field.type === 'select') {
            input = document.createElement('select');
            field.options?.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                input.appendChild(option);
            });
        } else {
            input = document.createElement('input');
            // Map types
            if (field.type === 'number' || field.type === 'calc') input.type = 'number';
            else if (field.type === 'date') input.type = 'date';
            else input.type = 'text';

            if (field.type === 'calc' || field.readonly) input.readOnly = true;
        }

        input.id = fieldPath;
        input.name = fieldPath;
        input.placeholder = field.placeholder || '';

        // Set initial value
        const val = this.engine.getValue(fieldPath);
        if (val !== undefined && val !== null) input.value = String(val);

        // Event Binding
        input.addEventListener('input', (e) => {
            let val: any = (e.target as HTMLInputElement).value;
            if (field.type === 'number') val = parseFloat(val);
            this.engine.setValue(fieldPath, val);
        });

        wrapper.appendChild(input);

        // Error
        const errorContainer = document.createElement('div');
        errorContainer.className = 'tobari-error';
        errorContainer.style.color = 'red';
        wrapper.appendChild(errorContainer);

        return wrapper;
    }

    private updateUI(state: any) {
        // Naive update: Select all inputs and update values
        const inputs = this.container.querySelectorAll('input, select');
        inputs.forEach((el) => {
            const input = el as HTMLInputElement;
            const name = input.name;
            // getIn from state.values
            const newVal = this.getIn(state.values, name);

            // Avoid cursor jump: update only if different and not currently focused (unless readonly/calc)
            if (String(newVal) !== input.value) {
                // Basic Check: if element is focused and typing, don't overwrite unless necessary
                // For Calc fields, always overwrite
                if (input.readOnly || document.activeElement !== input) {
                    input.value = newVal !== undefined && newVal !== null ? String(newVal) : '';
                }
            }
        });
    }

    // Helper duplicated from path.ts
    private getIn(obj: any, path: string): any {
        if (!path) return undefined;
        const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
        let result = obj;
        for (const key of keys) {
            if (result === null || result === undefined) return undefined;
            result = result[key];
        }
        return result;
    }
}
