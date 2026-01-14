import { parseAttribute, hasAttribute } from './utils';
import yaml from 'js-yaml';

// Minimal stub for Renderers
const Renderers = {
    escapeHtml: (s: string) => s,
    renderInput: (type: string, key: string, attrs: string) => '',
    setMasterData: (d: any) => {},
};

export function parseMarkdown(text: string): { jsonStructure: any } {
    const lines = text.split('\n');

    let jsonStructure: any = { "@context": "https://schema.org", "@type": "CreativeWork", needsPostal: false };
    
    // Phase 0: Pre-scan for Master Data
    const masterData: Record<string, string[][]> = {};
    let scanInMaster = false;
    let scanMasterKey: string = '';
    let scanInCodeBlock = false;

    lines.forEach(line => {
        const t = line.trim();
        if (t.startsWith('```')) {
            scanInCodeBlock = !scanInCodeBlock;
            return;
        }
        if (scanInCodeBlock) return;

        // Match [master:key]
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

    let currentDynamicTableKey: string | null = null;
    let currentDynamicTableHeaders: string[] = [];
    let dynamicTableProcessed: boolean = false; // Track if we've processed the template row
    let currentStaticTable: any = null;
    let inTable = false;
    let inMasterTable = false;
    let currentMasterKey: string = '';
    let currentSectionTitle: string | null = null;

    jsonStructure.fields = [];
    jsonStructure.tables = {};
    jsonStructure.tableLabels = {}; // Store table labels found from headers
    jsonStructure.masterData = masterData;

    let inCodeBlock = false;

    lines.forEach((line) => {
        const trimmed = line.trim();

        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            return;
        }
        if (inCodeBlock) return;

        // 0a. Master Table Marker
        const masterMatch = trimmed.match(/^\[master:([^\]]+)\]$/);
        if (masterMatch) {
            currentMasterKey = masterMatch[1] || '';
            return;
        }

        // Match [dynamic table:key] or [dynamic-table:key]
        const dynTableMatch = trimmed.match(/^\[dynamic\s*-?\s*table:([^\]]+)\]$/);
        if (dynTableMatch) {
            currentDynamicTableKey = dynTableMatch[1] || '';
            jsonStructure.tables[currentDynamicTableKey] = [];
            currentDynamicTableHeaders = []; // Reset headers
            dynamicTableProcessed = false; // Reset flag for new dynamic table

            // Assign section title as label if available
            if (currentSectionTitle) {
                jsonStructure.tableLabels[currentDynamicTableKey] = currentSectionTitle;
                currentSectionTitle = null; // Consume it
            }

            return;
        }

        // 0b. Table Logic
        if (trimmed.startsWith('|')) {
            const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
            const isSeparator = cells.every(c => c.match(/^-+$/));

            if (!inTable) {
                // New table starting
                inTable = true;
                inMasterTable = !!currentMasterKey;

                if (currentDynamicTableKey && !isSeparator) {
                    // Check if this is a new table header after we've already processed the template row
                    const hasFieldDefs = cells.some(c => c.includes('['));
                    if (dynamicTableProcessed && !hasFieldDefs) {
                        // This is a summary/total table after the dynamic table, end dynamic table
                        currentDynamicTableKey = null;
                        currentDynamicTableHeaders = [];
                        dynamicTableProcessed = false;
                        // Don't return, continue to process as potential static table
                    } else {
                        currentDynamicTableHeaders = cells; // Capture headers
                    }
                }

                if (!currentDynamicTableKey && !inMasterTable && !isSeparator) {
                    // Start Static Table
                    currentStaticTable = {
                        type: 'static_table',
                        key: 'tbl_' + Math.random().toString(36).substr(2, 5),
                        label: currentSectionTitle || '', // Use section title as label
                        headers: cells,
                        rows: []
                    };
                    if (currentSectionTitle) currentSectionTitle = null; // Consume
                }
            }

            if (!isSeparator) {
                if (currentDynamicTableKey) {
                    // For dynamic tables, we only process the first row with input fields as the template
                    const hasInput = cells.some(c => c.includes('['));
                    if (hasInput && !dynamicTableProcessed) {
                        // Extract schema only if we haven't processed the template row yet
                        const tableKey = currentDynamicTableKey!;
                        cells.forEach((cell, colIndex) => {
                            // Match [type:key (attrs)] or [key (attrs)]
                            const tagMatch = cell.match(/\[(?:([a-z]+):)?([^\]\s:\(\)]+)(?:\s*\((.*?)\))?\]/);
                            if (tagMatch) {
                                let [_, type, key, attrs] = tagMatch;
                                // Use header as label if available, fallback to placeholder, then key
                                const headerLabel = currentDynamicTableHeaders[colIndex];
                                const label = headerLabel || parseAttribute(attrs, 'placeholder') || key;

                                const tableData = jsonStructure.tables[tableKey];
                                if (tableData) {
                                     if (!tableData.find(ex => ex.key === key)) {
                                        tableData.push({ key, label, type: type || 'text', attributes: attrs });
                                     }
                                }
                            }
                        });
                        dynamicTableProcessed = true; // Mark that we've processed the template row
                    }
                } else if (!inMasterTable && currentStaticTable) {
                    // Static table row
                    // Skip if it's the same row object as headers (first row)
                    if (currentStaticTable.headers !== cells) {
                         const rowData = cells.map(cell => {
                            const tagMatch = cell.match(/\[(?:([a-z]+):)?([^\]\s:\(\)]+)(?:\s*\((.*?)\))?\]/);
                            if (tagMatch) {
                                let [_, type, key, attrs] = tagMatch;
                                const cleanLabel = parseAttribute(attrs, 'placeholder') || key;
                                // Return field definition object
                                return {
                                    key, label: cleanLabel, type: type || 'text',
                                    show_if: parseAttribute(attrs, 'show_if') ?? undefined,
                                    required: hasAttribute(attrs, 'required'),
                                    attributes: attrs
                                };
                            } else {
                                return cell; // Plain text
                            }
                        });
                        currentStaticTable.rows.push(rowData);
                    }
                }
            }
            return;
        } else {
            // End of table detection
            if (inTable && trimmed.length > 0) {
                if (currentStaticTable) {
                    jsonStructure.fields.push(currentStaticTable);
                    currentStaticTable = null;
                }
                
                if (currentDynamicTableKey) {
                    currentDynamicTableKey = null;
                    currentDynamicTableHeaders = [];
                    dynamicTableProcessed = false;
                }
                inTable = false;
                inMasterTable = false;
                currentMasterKey = ''; 
            }
            
            if (trimmed.startsWith('#') || (trimmed.startsWith('- [') && !trimmed.includes('|'))) {
                 currentDynamicTableKey = null;
                 currentDynamicTableHeaders = [];
                 dynamicTableProcessed = false;
                 if (currentStaticTable) {
                    jsonStructure.fields.push(currentStaticTable);
                    currentStaticTable = null;
                 }
            }
        }

        // 1. Headers
        const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (headerMatch) {
            const level = headerMatch[1] ? headerMatch[1].length : 1;
            const content = headerMatch[2] || '';
            if (level === 1) {
                jsonStructure.name = content;
            }
            // Capture section title for later use
            currentSectionTitle = content;
        }
        // 3. Syntax: - [type:key (attrs)] Label
        else if (trimmed.startsWith('- [')) {
            const match = trimmed.match(/^-\s*\[(?:([a-z]+):)?([^\ ]+)(?:\s*\((.*)\))?\]\s*(.*)$/);

            if (match) {
                const [_, type, key, attrs, label] = match;
                const cleanLabel = (label || '').trim();
                const attrStr = attrs || '';

                if (parseAttribute(attrStr, 'autofill') === 'postal') {
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
                
                // Clear title if consumed by a field? Maybe not needed for single fields.
                // But for tables we want it.
            }
        }
        // Inline Tags in normal text (simplified check)
        else if (trimmed.includes('[') && trimmed.includes(']')) {
             const tagRegex = /\[(?:([a-z]+):)?([^\]\s:\(\)]+)(?:\s*\((.*?)\))?\]/g;
             let match;
             while ((match = tagRegex.exec(trimmed)) !== null) {
                const [fullMatch, type, key, attrs] = match;
                const attrStr = attrs || '';
                const typeStr = type || 'text';
                const cleanLabel = parseAttribute(attrStr, 'placeholder') || key;
                jsonStructure.fields.push({
                    key, label: cleanLabel, type: typeStr,
                    required: hasAttribute(attrStr, 'required'),
                    attributes: attrStr
                });
             }
        }
    });
    
    if (currentStaticTable) {
        jsonStructure.fields.push(currentStaticTable);
    }

    return { jsonStructure };
}
