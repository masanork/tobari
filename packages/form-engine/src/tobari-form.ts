import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
    FormDefinitionSchema,
    type FormDefinition,
    type FormElement,
    type TextField,
    type IntegerField,
    type SelectField,
    type GroupField
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
  `;

    @property({ type: Object })
    definition: FormDefinition | null = null;

    @state()
    private formData: Record<string, any> = {};

    @state()
    private errors: Record<string, string> = {};

    // Load definition from JSON object
    setSchema(schema: unknown) {
        try {
            this.definition = FormDefinitionSchema.parse(schema);
            this.requestUpdate();
        } catch (e) {
            console.error("Invalid Schema:", e);
            this.errors['global'] = "Invalid Form Schema";
        }
    }

    private handleInput(e: Event, path: string[]) {
        const target = e.target as HTMLInputElement | HTMLSelectElement;
        let value: any = target.value;

        if (target.type === 'number') {
            value = value === '' ? undefined : Number(value);
        }

        // Deep merge value into formData
        // For MVP, we stick to flat-ish keys or simple object structure.
        // Let's implement simple deep set based on path.
        this.updateDataAtPath(this.formData, path, value);
        this.requestUpdate(); // Trigger re-render (optional, maybe too expensive for huge forms)
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

    private submit() {
        console.log("Submitting:", this.formData);
        const event = new CustomEvent('tobari-submit', {
            detail: { data: this.formData },
            bubbles: true,
            composed: true
        });
        this.dispatchEvent(event);
    }

    // --- Renderers ---

    private renderTextField(field: TextField, path: string[]) {
        const val = this.getValue(path) || '';
        return html`
      <div class="field-group">
        <label>
          ${field.label || field.key} 
          ${field.required ? '*' : ''}
        </label>
        <input 
          type="text" 
          .value=${val}
          @input=${(e: Event) => this.handleInput(e, path)}
          placeholder=${field.placeholder || ''}
          ?required=${field.required}
          minlength=${field.minLength || nothing}
          maxlength=${field.maxLength || nothing}
          pattern=${field.pattern || nothing}
        >
      </div>
    `;
    }

    private renderIntegerField(field: IntegerField, path: string[]) {
        const val = this.getValue(path) ?? '';
        return html`
      <div class="field-group">
        <label>
          ${field.label || field.key}
          ${field.required ? '*' : ''}
        </label>
        <input 
          type="number"
          .value=${val}
          @input=${(e: Event) => this.handleInput(e, path)}
          min=${field.min || nothing}
          max=${field.max || nothing}
          step=${field.step}
          ?required=${field.required}
        >
      </div>
    `;
    }

    private renderSelectField(field: SelectField, path: string[]) {
        const val = this.getValue(path) || '';
        return html`
      <div class="field-group">
        <label>${field.label || field.key}</label>
        <select @change=${(e: Event) => this.handleInput(e, path)} .value=${val}>
          <option value="" disabled ?selected=${!val}>Select...</option>
          ${field.options.map(([optVal, optLabel]) => html`
            <option value=${optVal} ?selected=${val === optVal}>${optLabel}</option>
          `)}
        </select>
      </div>
    `;
    }

    private renderGroupField(field: GroupField, path: string[]) {
        return html`
      <div class="field-group">
        <div class="group-container">
          <span class="group-label">${field.label || field.key}</span>
          ${field.fields.map(child => this.renderField(child, [...path, child.key]))}
        </div>
      </div>
    `;
    }

    private renderField(field: FormElement, path: string[]): any {
        switch (field.type) {
            case 'text': return this.renderTextField(field, path);
            case 'integer': return this.renderIntegerField(field, path);
            case 'select': return this.renderSelectField(field, path);
            case 'group': return this.renderGroupField(field, path);
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
