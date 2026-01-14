import { parseAttribute, hasAttribute, escapeHtml, stripAttribute } from './utils';

export interface RendererContext {
    masterData: Record<string, string[][]>;
}

export const Renderers: Record<string, any> = {
    _context: { masterData: {} } as RendererContext,

    setMasterData(data: Record<string, string[][]>) {
        this._context.masterData = data;
    },

    escapeHtml(str: string): string {
        return escapeHtml(str);
    },

    formatHint(text: string): string {
        const escaped = this.escapeHtml(text);
        return escaped
            .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
            .replace(/\r?\n/g, '<br>');
    },

    getStyle(attrs: string | undefined): string {
        if (!attrs) return '';
        let style = '';
        if (attrs.includes('size:L')) style += 'font-size: 1.25em;';
        if (attrs.includes('size:S')) style += 'font-size: 0.8em;';
        if (attrs.includes('size:XL')) style += 'font-size: 1.5em; font-weight: bold;';
        if (attrs.includes('align:R')) style += 'text-align: right;';
        if (attrs.includes('align:C')) style += 'text-align: center;';
        if (attrs.includes('bold')) style += 'font-weight: bold;';
        return style;
    },

    getSemanticAttrs(key: string, attrs: string | undefined): string {
        if (!attrs) return '';
        let semantic = '';

        // Infer from key name patterns
        const keyLower = key.toLowerCase();
        
        // Phone numbers
        if (keyLower.includes('phone') || keyLower.includes('tel') || keyLower.includes('電話')) {
            semantic += ' type="tel" inputmode="tel" autocomplete="tel"';
        }
        // Email
        else if (keyLower.includes('email') || keyLower.includes('mail') || keyLower.includes('メール')) {
            semantic += ' type="email" inputmode="email" autocomplete="email"';
        }
        // Postal code
        else if (keyLower.includes('zip') || keyLower.includes('postal') || keyLower.includes('郵便')) {
            semantic += ' inputmode="numeric" autocomplete="postal-code"';
        }
        // Name fields
        else if (keyLower.includes('name') || keyLower.includes('氏名') || keyLower.includes('名前')) {
            if (keyLower.includes('sei') || keyLower.includes('姓') || keyLower.includes('family')) {
                semantic += ' autocomplete="family-name"';
            } else if (keyLower.includes('mei') || keyLower.includes('名') || keyLower.includes('given')) {
                semantic += ' autocomplete="given-name"';
            } else {
                semantic += ' autocomplete="name"';
            }
        }
        // Organization
        else if (keyLower.includes('company') || keyLower.includes('organization') || keyLower.includes('会社') || keyLower.includes('組織')) {
            semantic += ' autocomplete="organization"';
        }
        // Address fields
        else if (keyLower.includes('address') || keyLower.includes('住所')) {
            if (keyLower.includes('1') || keyLower.includes('line1')) {
                semantic += ' autocomplete="address-line1"';
            } else if (keyLower.includes('2') || keyLower.includes('line2')) {
                semantic += ' autocomplete="address-line2"';
            } else {
                semantic += ' autocomplete="street-address"';
            }
        }
        // Prefecture/State
        else if (keyLower.includes('pref') || keyLower.includes('都道府県') || keyLower.includes('state')) {
            semantic += ' autocomplete="address-level1"';
        }
        // City
        else if (keyLower.includes('city') || keyLower.includes('市区町村')) {
            semantic += ' autocomplete="address-level2"';
        }

        // Explicit attribute overrides
        const autocomplete = parseAttribute(attrs, 'autocomplete');
        if (autocomplete) {
            // Replace inferred autocomplete with explicit one
            semantic = semantic.replace(/autocomplete="[^"]*"/, '');
            semantic += ` autocomplete="${this.escapeHtml(autocomplete)}"`;
        }

        const inputmode = parseAttribute(attrs, 'inputmode');
        if (inputmode) {
            semantic = semantic.replace(/inputmode="[^"]*"/, '');
            semantic += ` inputmode="${this.escapeHtml(inputmode)}"`;
        }

        return semantic;
    },

    getExtraAttrs(attrs: string | undefined): string {
        if (!attrs) return '';
        let extra = '';
        
        const len = parseAttribute(attrs, 'len') || parseAttribute(attrs, 'max');
        if (len && /^\d+$/.test(len)) extra += ` maxlength="${len}"`;

        const val = parseAttribute(attrs, 'val') || parseAttribute(attrs, 'value');
        if (val) extra += ` value="${this.escapeHtml(val)}"`;

        const context = parseAttribute(attrs, 'context');
        if (context) extra += ` data-context="${this.escapeHtml(context)}"`;

        const property = parseAttribute(attrs, 'property');
        if (property) extra += ` data-property="${this.escapeHtml(property)}"`;

        const showIf = parseAttribute(attrs, 'show_if');
        if (showIf) extra += ` data-show-if="${this.escapeHtml(showIf)}"`;

        const autofill = parseAttribute(attrs, 'autofill');
        if (autofill) extra += ` data-autofill="${this.escapeHtml(autofill)}"`;

        // Pass through standard validation attributes
        const validationAttrs = ['min', 'max', 'step', 'pattern', 'required', 'readonly', 'disabled', 'minlength', 'maxlength'];
        validationAttrs.forEach(attr => {
            const value = parseAttribute(attrs, attr);
            if (value !== null) {
                if (value === 'true' || value === '') extra += ` ${attr}`;
                else extra += ` ${attr}="${this.escapeHtml(value)}"`;
            } else if (hasAttribute(attrs, attr)) {
                extra += ` ${attr}`;
            }
        });

        return extra;
    },

    // --- Component Renderers ---

    'text': function (key: string, label: string, attrs: string | undefined) {
        const val = parseAttribute(attrs, 'val') || parseAttribute(attrs, 'value') || '';
        const placeholder = parseAttribute(attrs, 'placeholder') || '';
        const hintText = parseAttribute(attrs, 'hint') || parseAttribute(attrs, 'context') || '';
        const hint = hintText ? `<div class="form-hint">${this.formatHint(hintText)}</div>` : '';
        const semanticAttrs = this.getSemanticAttrs(key, attrs);

        return `
        <div class="form-row" style="${this.getStyle(attrs)}">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <input ${semanticAttrs ? semanticAttrs : 'type="text"'} class="form-input" data-json-path="${key}" value="${this.escapeHtml(val)}" placeholder="${this.escapeHtml(placeholder)}" style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
            ${hint}
        </div>`;
    },

    'number': function (key: string, label: string, attrs: string | undefined) {
        const placeholder = parseAttribute(attrs, 'placeholder') || '';
        const hintText = parseAttribute(attrs, 'hint') || parseAttribute(attrs, 'context') || '';
        const hint = hintText ? `<div class="form-row"><div class="form-hint">${this.formatHint(hintText)}</div></div>` : '';

        return `
        <div class="form-row">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <input type="number" inputmode="decimal" class="form-input" data-json-path="${key}" placeholder="${this.escapeHtml(placeholder)}" style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
            ${hint}
        </div>`;
    },

    'date': function (key: string, label: string, attrs: string | undefined) {
        return `
        <div class="form-row">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <input type="date" class="form-input" data-json-path="${key}" style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
        </div>`;
    },

    'textarea': function (key: string, label: string, attrs: string | undefined) {
        const placeholder = parseAttribute(attrs, 'placeholder') || '';
        const hintText = parseAttribute(attrs, 'hint') || parseAttribute(attrs, 'context') || '';
        const hint = hintText ? `<div class="form-hint">${this.formatHint(hintText)}</div>` : '';
        const val = parseAttribute(attrs, 'val') || parseAttribute(attrs, 'value') || '';

        return `
        <div class="form-row vertical" style="${this.getStyle(attrs)}">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <textarea class="form-input" rows="5" data-json-path="${key}" placeholder="${this.escapeHtml(placeholder)}" style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>${this.escapeHtml(val)}</textarea>
            ${hint}
        </div>`;
    },

    'radioStart': function (key: string, label: string, attrs: string | undefined) {
        return `
        <div class="form-row vertical" style="${this.getStyle(attrs)}">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <div class="radio-group" style="padding-left: 10px;">`;
    },

    'radioOption': function (name: string, val: string, label: string, checked: boolean) {
        return `
            <label style="display:block; margin-bottom:5px;">
                <input type="radio" name="${name}" value="${this.escapeHtml(val)}" ${checked ? 'checked' : ''}> ${this.escapeHtml(label)}
            </label>`;
    },

    'calc': function (key: string, label: string, attrs: string | undefined) {
        const formula = parseAttribute(attrs, 'formula') || '';
        return `
        <div class="form-row">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <input type="text" readonly class="form-input" data-json-path="${key}" data-formula="${this.escapeHtml(formula)}" style="background:#f9f9f9; ${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
        </div>`;
    },

    'search': function (key: string, label: string, attrs: string | undefined) {
        const srcKey = parseAttribute(attrs, 'src') || '';
        const labelIdx = parseAttribute(attrs, 'label') || '';
        const valueIdx = parseAttribute(attrs, 'value') || '';
        const placeholder = parseAttribute(attrs, 'placeholder') || '';
        const hintText = parseAttribute(attrs, 'hint') || '';
        const hint = hintText ? `<div class="form-hint">${this.formatHint(hintText)}</div>` : '';
        
        const labelIndexAttr = labelIdx ? ` data-master-label-index="${labelIdx}"` : '';
        const valueIndexAttr = valueIdx ? ` data-master-value-index="${valueIdx}"` : '';

        let cleanAttrs = stripAttribute(attrs, 'value');
        cleanAttrs = stripAttribute(cleanAttrs, 'label');
        cleanAttrs = stripAttribute(cleanAttrs, 'src');

        return `
        <div class="form-row autocomplete-container" style="position:relative; z-index:100;">
            <label class="form-label">${this.escapeHtml(label)}</label>
            <div style="flex:1; position:relative;">
                <input type="text" class="form-input search-input" autocomplete="off" 
                    data-json-path="${key}" 
                    data-master-src="${srcKey}"${labelIndexAttr}${valueIndexAttr}
                    placeholder="${this.escapeHtml(placeholder)}" 
                    style="${this.getStyle(attrs)}"${this.getExtraAttrs(cleanAttrs)}>
                <div class="search-suggestions" style="display:none; position:absolute; top:100%; left:0; width:100%; background:white; border:1px solid #ccc; max-height:200px; overflow-y:auto; box-shadow:0 4px 6px rgba(0,0,0,0.1); border-radius:0 0 4px 4px; z-index:1001;"></div>
            </div>
            ${hint}
        </div>`;
    },

    renderInput(type: string, key: string, attrs: string | undefined, isTemplate: boolean = false): string {
        const placeholderVal = parseAttribute(attrs, 'placeholder') || '';
        const placeholder = placeholderVal ? `placeholder="${this.escapeHtml(placeholderVal)}"` : '';
        const commonClass = isTemplate ? 'form-input template-input' : 'form-input';
        const dataAttr = isTemplate ? `data-base-key="${key}"` : `data-json-path="${key}"`;

        if (type === 'calc') {
            const formula = parseAttribute(attrs, 'formula') || '';
            return `<input type="text" readonly class="${commonClass}" ${dataAttr} data-formula="${this.escapeHtml(formula)}" style="background:#f9f9f9; text-align:right; ${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
`;
        }

        if (type === 'datalist') {
            const srcKey = parseAttribute(attrs, 'src') || '';
            const labelIdx = parseAttribute(attrs, 'label') || '1';
            let optionsHtml = '';
            if (srcKey && this._context.masterData && this._context.masterData[srcKey]) {
                const data = this._context.masterData[srcKey];
                const lIdx = parseInt(labelIdx, 10) - 1;
                data.forEach((row: string[]) => {
                    if (row.length > lIdx) {
                        optionsHtml += `<option value="${this.escapeHtml(row[lIdx] || '')}"></option>`;
                    }
                });
            }
            const listId = 'list_' + key + '_' + Math.floor(Math.random() * 10000);
            return `<input type="text" list="${listId}" class="${commonClass}" ${dataAttr} ${placeholder} style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}><datalist id="${listId}">${optionsHtml}</datalist>`;
        }

        if (type === 'search') {
            const srcKey = parseAttribute(attrs, 'src') || '';
            const labelIdx = parseAttribute(attrs, 'label') || '';
            const valueIdx = parseAttribute(attrs, 'value') || '';
            
            const labelIndexAttr = labelIdx ? ` data-master-label-index="${labelIdx}"` : '';
            const valueIndexAttr = valueIdx ? ` data-master-value-index="${valueIdx}"` : '';
            const searchClass = commonClass + ' search-input';

            let suggestAttr = '';
            if (hasAttribute(attrs, 'suggest:column')) {
                suggestAttr = ' data-suggest-source="column"';
            }
            const copyFrom = parseAttribute(attrs, 'copy');
            const copyAttr = copyFrom ? ` data-copy-from="${this.escapeHtml(copyFrom)}"` : '';
            const bgStyle = copyFrom ? 'background-color: #ffffea;' : '';

            let cleanAttrs = stripAttribute(attrs, 'value');
            cleanAttrs = stripAttribute(cleanAttrs, 'label');
            cleanAttrs = stripAttribute(cleanAttrs, 'src');

            return `<div style="display:inline-block; position:relative; width: 100%; min-width: 100px;">
                        <input type="text" class="${searchClass}" ${dataAttr} autocomplete="off" data-master-src="${srcKey}"${labelIndexAttr}${valueIndexAttr} ${placeholder} style="${bgStyle} ${this.getStyle(attrs)}"${this.getExtraAttrs(cleanAttrs)}${suggestAttr}${copyAttr}>
                    </div>`;
        }

        if (type === 'number') {
            const copyFrom = parseAttribute(attrs, 'copy');
            const copyAttr = copyFrom ? ` data-copy-from="${this.escapeHtml(copyFrom)}"` : '';
            const bgStyle = copyFrom ? 'background-color: #ffffea;' : '';
            return `<input type="number" class="${commonClass}" ${dataAttr} ${placeholder} style="text-align:right; ${bgStyle} ${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}${copyAttr}>`;
        }

        if (type === 'date') {
            return `<input type="date" class="${commonClass}" ${dataAttr} style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
`;
        }

        if (type === 'checkbox') {
            return `<input type="checkbox" class="${commonClass}" ${dataAttr} style="${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
`;
        }

        if (type === 'autonum' || hasAttribute(attrs, 'autonum')) {
            const classList = commonClass + ' auto-num';
            return `<input type="number" readonly class="${classList}" ${dataAttr} data-autonum="true" style="background:transparent; border:none; text-align:center; width:100%; font-weight:bold; cursor:default; ${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}>
`;
        }

        // Default text
        let suggestAttr = '';
        let suggestClass = '';
        if (hasAttribute(attrs, 'suggest:column')) {
            suggestClass = ' search-input';
            suggestAttr = ' data-suggest-source="column"';
        }
        const copyFrom = parseAttribute(attrs, 'copy');
        const copyAttr = copyFrom ? ` data-copy-from="${this.escapeHtml(copyFrom)}"` : '';
        const bgStyle = copyFrom ? 'background-color: #ffffea;' : '';
        const semanticAttrs = this.getSemanticAttrs(key, attrs);

        return `<input ${semanticAttrs ? semanticAttrs : 'type="text"'} class="${commonClass}${suggestClass}" ${dataAttr} ${placeholder} style="${bgStyle} ${this.getStyle(attrs)}"${this.getExtraAttrs(attrs)}${suggestAttr}${copyAttr}>`;
    },

    tableRow(cells: string[], isTemplate = false) {
        const tds = cells.map(cell => {
            const trimmed = cell.trim();
            const match = trimmed.match(/^\[(?:([a-z]+):)?([^\]:\(\)]+)(?:\s*\((.*)\)|:([^\]]+))?\]$/);
            // console.log('tableRow match check:', trimmed, !!match);

            if (match) {
                let [_, type, keyPart, attrsParen, attrsColon] = match;
                let key = (keyPart || '').trim();
                let extraAttrs = attrsParen || attrsColon || '';

                if (key.includes(' ')) {
                    const parts = key.split(/\s+/);
                    key = parts[0]!;
                    extraAttrs = parts.slice(1).join(' ') + ' ' + extraAttrs;
                }

                const inputHtml = this.renderInput(type || 'text', key, extraAttrs, isTemplate);
                return `<td>${inputHtml}</td>`;
            } else {
                return `<td>${this.escapeHtml(trimmed)}</td>`;
            }
        }).join('');
        return `<tr ${isTemplate ? 'class="template-row"' : ''}>${tds}</tr>`;
    }
};
