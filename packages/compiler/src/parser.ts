import { Renderers } from './renderer';
import yaml from 'js-yaml';
import { parseAttribute, hasAttribute, escapeHtml } from './utils';

export function parseMarkdown(text: string): { html: string, jsonStructure: any } {
    const lines = text.split('\n');

    let html = '';
    let jsonStructure: any = { "@context": "https://schema.org", "@type": "CreativeWork", needsPostal: false };
    const aggSpecs: any[] = [];

    const parseAggSpec = (raw: string): any | null => {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        try {
            return JSON.parse(trimmed);
        } catch { } 
        try {
            return yaml.load(trimmed);
        } catch { } 
        return null;
    };

    // Phase 0: Pre-scan for Master Data
    const masterData: Record<string, string[][]> = {};
    let scanInMaster = false;
    let scanMasterKey: string = '';
    let scanInCodeBlock = false;

    lines.forEach(line => {
        const t = line.trim();
        if (t.startsWith('```')) {
            if (scanInCodeBlock) {
                scanInCodeBlock = false;
            } else {
                scanInCodeBlock = true;
            }
            return;
        }
        if (scanInCodeBlock) {
            return;
        }
        const masterMatch = t.match(/^\[master:([^\]]+)\]$/);
        if (masterMatch) {
            scanMasterKey = masterMatch[1] || '';
            masterData[scanMasterKey] = [];
            scanInMaster = true;
            return;
        }
        if (scanInMaster && scanMasterKey) {
            if (t.startsWith('|')) {
                const cells = t.split('|').slice(1, -1).map(c => c.trim());
                const isSep = cells.every(c => c.match(/^-+$/));
                if (!isSep && scanMasterKey && masterData[scanMasterKey]) {
                    const data = masterData[scanMasterKey];
                    if (data) data.push(cells);
                }
            } else {
                if (t.length > 0) scanInMaster = false;
            }
        }
    });
    // @ts-ignore
    Renderers.setMasterData(masterData);

    let currentRadioGroup: { key: string, label: string, attrs: string } | null = null;
    let currentDynamicTableKey: string | null = null;
    let inTable = false;
    let inMasterTable = false;
    let currentMasterKey: string = '';

    // Auto 2-column grid for consecutive single-line fields
    let singleLineFieldBuffer: string[] = [];

    // Aggregator Schema
    jsonStructure.fields = [];
    jsonStructure.tables = {};
    jsonStructure.masterData = masterData;

    // Tab Logic
    let tabs: { id: string, title: string, isSystem?: boolean }[] = [];
    let currentTabId: string | null = null;
    let mainContentHtml = '';
    let inCodeBlock = false;
    let codeLines: string[] = [];
    let codeLang = '';

    // Helper to append to the correct buffer
    const appendHtml = (str: string) => {
        mainContentHtml += str;
    };

    // Flush single-line field buffer with auto 2-column grid
    const flushSingleLineFields = () => {
        if (singleLineFieldBuffer.length === 0) return;

        if (singleLineFieldBuffer.length >= 2) {
            // Wrap in 2-column grid
            appendHtml('<div class="form-grid-2col">');
            singleLineFieldBuffer.forEach(html => appendHtml(html));
            appendHtml('</div>');
        } else {
            // Single field, output as-is
            appendHtml(singleLineFieldBuffer[0]!);
        }

        singleLineFieldBuffer = [];
    };

    const processInlineTags = (text: string) => {
        const tagRegex = /\ \[(?:([a-z]+):)?([^\ ]+)(?:\ \((.*?)\))?\]/g;
        let lastIndex = 0;
        let result = '';
        let match;

        while ((match = tagRegex.exec(text)) !== null) {
            // Escape text before the tag
            result += Renderers.escapeHtml(text.substring(lastIndex, match.index));

            const [fullMatch, type, key, attrs] = match;
            const attrStr = attrs || '';
            const typeStr = type || 'text';
            
            const cleanLabel = parseAttribute(attrStr, 'placeholder') || key;

                        jsonStructure.fields.push({

                            key, label: cleanLabel, type: typeStr,

                            context: parseAttribute(attrStr, 'context') ?? undefined,

                            property: parseAttribute(attrStr, 'property') ?? undefined,

                            show_if: parseAttribute(attrStr, 'show_if') ?? undefined,

                            required: hasAttribute(attrStr, 'required'),

                            attributes: attrStr

                        });

            // Render tag (already produces safe HTML)
            result += Renderers.renderInput(typeStr, key, attrStr);
            lastIndex = tagRegex.lastIndex;
        }

        // Escape remaining text
        result += Renderers.escapeHtml(text.substring(lastIndex));

        // Post-processing: Basic Markdown formatting
        // Order is important: Bold before Italic
        result = result
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/__(.*?)__/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/_(.*?)_/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
            .replace(/\[([^\]]+)\]\(([\.\/][^\)]+)\)/g, '<a href="$2">$1</a>');

        return result;
    };

    lines.forEach((line) => {
        const trimmed = line.trim();

        if (trimmed.startsWith('```')) {
            if (inCodeBlock) {
                if (codeLang === 'agg') {
                    const parsed = parseAggSpec(codeLines.join('\n'));
                    if (parsed) aggSpecs.push(parsed);
                } else {
                    const langClass = codeLang ? ` class="language-${codeLang}"` : '';
                    appendHtml(`<pre><code${langClass}>${Renderers.escapeHtml(codeLines.join('\n'))}</code></pre>`);
                }
                inCodeBlock = false;
                codeLines = [];
                codeLang = '';
            } else {
                flushSingleLineFields();
                if (currentRadioGroup) { appendHtml('</div></div>'); currentRadioGroup = null; }
                inCodeBlock = true;
                codeLang = trimmed.slice(3).trim().split(/\s+/)[0] || '';
                codeLines = [];
            }
            return;
        }

        if (inCodeBlock) {
            codeLines.push(line);
            return;
        }

        // 0a. Master Table Marker (Allow unicode keys)
        const masterMatch = trimmed.match(/^\[master:([^\]]+)\]$/);
        if (masterMatch) {
            currentMasterKey = masterMatch[1] || '';
            return;
        }

        const dynTableMatch = trimmed.match(/^\[dynamic\s*-?\s*table:([^\]]+)\]$/);
        if (dynTableMatch) {
            currentDynamicTableKey = dynTableMatch[1] || '';
            jsonStructure.tables[currentDynamicTableKey] = [];
            return;
        }

        // 0b. Table Logic
        if (trimmed.startsWith('|')) {
            if (!inTable) { // Start a new table if we aren't in one
                flushSingleLineFields(); // Flush before table
                appendHtml('<div class="form-row vertical"><div class="table-wrapper">');

                let tableClass = 'data-table';
                let extraAttrs = '';

                if (currentDynamicTableKey) {
                    tableClass += ' dynamic';
                    extraAttrs = `id="tbl_${currentDynamicTableKey}" data-table-key="${currentDynamicTableKey}"`;
                } else if (currentMasterKey) {
                    tableClass += ' master';
                    extraAttrs = `data-master-key="${currentMasterKey}"`;
                }

                appendHtml(`<table class="${tableClass}" ${extraAttrs}>`);
                appendHtml(`<tbody>`);

                inTable = true;
                // We track if this specific table session is a master table, mostly for structure logic if needed
                inMasterTable = !!currentMasterKey;
            }

            const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
            const isSeparator = cells.every(c => c.match(/^-+$/));

            if (isSeparator) {
                // ignore separator lines in HTML usually
            } else {
                if (currentDynamicTableKey) {
                    const hasInput = cells.some(c => c.includes('['));
                    if (!hasInput) {
                        appendHtml(`<tr>${cells.map(c => `<th>${Renderers.escapeHtml(c)}</th>`).join('')}<th class="row-action-cell"></th></tr>`);
                    } else {
                        // Extract schema
                        const tableKey = currentDynamicTableKey!;
                        cells.forEach(cell => {
                            const tagMatch = cell.match(/\[(?:([a-z]+):)?([^\]\s:\(\)]+)(?:\s*\((.*?)\))?\]/);
                            if (tagMatch) {
                                let [_, type, key, attrs] = tagMatch;
                                const label = parseAttribute(attrs, 'placeholder') || key;
                                const tableData = jsonStructure.tables[tableKey];
                                if (tableData) { tableData.push({ key, label, type: type || 'text' }); } 
                            }
                        });
                        // @ts-ignore
                        let trHtml = Renderers.tableRow(cells, true);
                        // Inject Delete Button cell for dynamic rows
                        trHtml = trHtml.replace('</tr>', '<td class="row-action-cell"><button type="button" class="remove-row-btn" data-action="remove-row" onclick="removeTableRow(this)" tabindex="-1">×</button></td></tr>');
                        appendHtml(trHtml);
                    }
                } else if (inMasterTable) {
                    // @ts-ignore
                    appendHtml(Renderers.tableRow(cells));
                } else {
                    // Static table (no master, no dynamic)
                    // Extract field metadata from cells before rendering
                    cells.forEach(cell => {
                        const tagMatch = cell.match(/\[(?:([a-z]+):)?([^\]\s:\(\)]+)(?:\s*\((.*?)\))?\]/);
                        if (tagMatch) {
                            let [_, type, key, attrs] = tagMatch;
                            const cleanLabel = parseAttribute(attrs, 'placeholder') || key;

                                                        jsonStructure.fields.push({

                                                            key, label: cleanLabel, type: type || 'text',

                                                            show_if: parseAttribute(attrs, 'show_if') ?? undefined,

                                                            required: hasAttribute(attrs, 'required'),

                                                            attributes: attrs

                                                        });
                        }
                    });
                    // @ts-ignore
                    appendHtml(Renderers.tableRow(cells));
                }
            }
            return;
        } else {
            if (inTable) {
                appendHtml('</tbody></table></div>');
                if (currentDynamicTableKey) {
                    appendHtml(`<button type="button" class="add-row-btn" onclick="addTableRow(this, '${currentDynamicTableKey}')" data-i18n="add_row">+ 行を追加</button>`);
                    currentDynamicTableKey = null;
                }
                appendHtml('</div>');
                inTable = false;
                inMasterTable = false;
                currentMasterKey = ''; 
            }
        }

        // 1. Headers
        const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (headerMatch) {
            flushSingleLineFields(); // Flush before header
            const level = headerMatch[1] ? headerMatch[1].length : 1;
            const content = headerMatch[2] || '';

            if (level === 1) {
                // H1 is Document Title
                appendHtml(`<h1>${Renderers.escapeHtml(content)}</h1>`);
                jsonStructure.name = content;
            } else if (level === 2) {
                // H2 is Tab
                if (currentTabId) {
                    appendHtml('</div>'); // Close previous tab
                }
                const isSystem = content.includes('(Config)') || content.includes('(Hidden)') || content.includes('(System)');
                const tabId = 'tab-' + (tabs.length + 1);

                tabs.push({ id: tabId, title: content, isSystem });
                currentTabId = tabId;

                const activeClass = (!isSystem && tabs.filter(t => !t.isSystem).length === 1) ? ' active' : '';
                const styleAttr = isSystem ? ' style="display:none !important;"' : '';
                appendHtml(`<div id="${tabId}" class="tab-content${activeClass}" data-tab-title="${Renderers.escapeHtml(content)}"${styleAttr}>`);
            } else {
                // H3-H6
                appendHtml(`<h${level}>${Renderers.escapeHtml(content)}</h${level}>`);
            }
            currentRadioGroup = null;
        }
        // 2. Radio Options (Indented)
        else if ((line.startsWith('  - ') || line.startsWith('\t- '))) {
            if (currentRadioGroup) {
                let label = trimmed.replace(/^-\s*/, '');
                let checked = false;
                if (label.startsWith('[x] ')) {
                    checked = true;
                    label = label.substring(4);
                }
                // @ts-ignore
                appendHtml(Renderers.radioOption(currentRadioGroup.key, label, label, checked));
            }
        }
        // 3. Syntax: - [type:key (attrs)] Label
        else if (trimmed.startsWith('- [')) {
            const match = trimmed.match(/^-\s*\[(?:([a-z]+):)?([^\]\s:\(\)]+)(?:\s*\((.*)\))?\]\s*(.*)$/);

            if (match) {
                const [_, type, key, attrs, label] = match;
                currentRadioGroup = null;
                const cleanLabel = (label || '').trim();
                const attrStr = attrs || '';

                // Check if this field needs postal data
                const autofillVal = parseAttribute(attrStr, 'autofill');
                if (autofillVal === 'postal') {
                    jsonStructure.needsPostal = true;
                }

                jsonStructure.fields.push({
                    key,
                    label: cleanLabel,
                    type: type || 'text',
                    context: parseAttribute(attrStr, 'context') ?? undefined,
                    property: parseAttribute(attrStr, 'property') ?? undefined,
                    show_if: parseAttribute(attrStr, 'show_if') ?? undefined,
                    required: hasAttribute(attrStr, 'required'),
                    attributes: attrStr
                });

                // Determine if this is a vertical (multi-line) field
                const isVerticalField = type === 'radio' || type === 'textarea';

                // Flush buffer if we encounter a vertical field
                if (isVerticalField) {
                    flushSingleLineFields();
                }

                // Render the field
                let fieldHtml = '';
                if (type === 'radio') {
                    currentRadioGroup = { key, label: cleanLabel, attrs: attrStr };
                    fieldHtml = Renderers.radioStart(key, cleanLabel, attrStr);
                }
                else if (type === 'text') fieldHtml = Renderers.text(key, cleanLabel, attrStr);
                else if (type === 'number') fieldHtml = Renderers.number(key, cleanLabel, attrStr);
                else if (type === 'date') fieldHtml = Renderers.date(key, cleanLabel, attrStr);
                else if (type === 'textarea') fieldHtml = Renderers.textarea(key, cleanLabel, attrStr);
                else if (type === 'search') fieldHtml = Renderers.search(key, cleanLabel, attrStr);
                else if (type === 'calc') fieldHtml = Renderers.calc(key, cleanLabel, attrStr);
                else if (type === 'datalist') fieldHtml = Renderers.renderInput(type, key, attrStr);
                else if (type && Renderers[type]) {
                    fieldHtml = (Renderers as any)[type](key, cleanLabel, attrStr);
                } else {
                    console.warn(`Unknown type: ${type}`, Object.keys(Renderers));
                    fieldHtml = `<p style="color:red">Unknown type: ${type}</p>`;
                }

                if (isVerticalField) {
                    appendHtml(fieldHtml);
                } else {
                    singleLineFieldBuffer.push(fieldHtml);
                }
            }
        }
        else if (trimmed.startsWith('---')) {
            flushSingleLineFields(); // Flush before horizontal rule
            if (!currentTabId) { // Only render HR if not in tabs
                appendHtml('<hr>');
            }
            currentRadioGroup = null;
        }
        // HTML Passthrough for layout
        else if (trimmed.startsWith('<')) {
            flushSingleLineFields(); // Flush before HTML passthrough
            if (currentRadioGroup) { appendHtml('</div></div>'); currentRadioGroup = null; }
            if (trimmed.includes('[') && trimmed.includes(']')) {
                appendHtml(processInlineTags(trimmed));
            } else {
                appendHtml(trimmed);
            }
        }
        else if (trimmed.length > 0) {
            flushSingleLineFields(); // Flush before paragraph
            if (currentRadioGroup) { appendHtml('</div></div>'); currentRadioGroup = null; }
            appendHtml(`<p>${processInlineTags(trimmed)}</p>`);
        } else {
            flushSingleLineFields(); // Flush on empty line
            if (currentRadioGroup) { appendHtml('</div></div>'); currentRadioGroup = null; }
        }
    });

    // Flush any remaining buffered fields
    flushSingleLineFields();

    if (inTable) {
        appendHtml('</tbody></table></div>');
        if (currentDynamicTableKey) {
            appendHtml(`<button type="button" class="add-row-btn" data-action="add-row" data-table-key="${currentDynamicTableKey}" onclick="addTableRow(this, '${currentDynamicTableKey}')" data-i18n="add_row">+ 行を追加</button>`);
            currentDynamicTableKey = null;
        }
        appendHtml('</div>');
    }
    if (currentRadioGroup) appendHtml('</div></div>');
    if (currentTabId) appendHtml('</div>'); // Close last tab

    // Final Assembly
    const submitAction = jsonStructure.require_signature ? 'sign-download' : 'submit-document';
    const toolbarButtons = `
            <div style="flex:1"></div>
            <button class="btn-clear" data-action="clear-data" data-i18n="clear_btn">Clear</button>
            <button class="secondary" data-action="save-draft" data-i18n="work_save_btn">Save Progress</button>
            <button class="primary btn-submit-incomplete" id="btn-submit" data-action="${submitAction}" data-i18n="sign_btn">Submit</button>
    `;

    if (tabs.length > 0) {
        let navHtml = '<div class="tabs-nav">';
        let visibleTabCount = 0;

        tabs.forEach((tab) => {
            if (tab.isSystem) return;
            const activeClass = visibleTabCount === 0 ? ' active' : '';
            navHtml += `<button class="tab-btn${activeClass}" data-action="switch-tab" data-tab-id="${tab.id}" onclick="switchTab(this, '${tab.id}')">${Renderers.escapeHtml(tab.title)}</button>`;
            visibleTabCount++;
        });

        navHtml += `
            <div class="no-print" style="display: flex; gap: 10px; align-items: center; flex-grow: 1; padding-left: 20px;">
                ${toolbarButtons}
            </div>
        `;
        navHtml += '</div>';

        if (mainContentHtml.includes('</h1>')) {
            html = mainContentHtml.replace('</h1>', '</h1>' + navHtml);
        } else {
            html = navHtml + mainContentHtml;
        }
    } else {
        const toolbarHtml = `<div class="no-print form-toolbar" style="display: flex; gap: 10px; align-items: center; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee;">
            ${toolbarButtons}
        </div>`;
        html = mainContentHtml + toolbarHtml;
    }

    if (aggSpecs.length === 1) {
        jsonStructure.aggSpec = aggSpecs[0];
    } else if (aggSpecs.length > 1) {
        jsonStructure.aggSpec = aggSpecs;
    }

    return { html, jsonStructure };
}
