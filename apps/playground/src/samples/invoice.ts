import type { FormDefinition } from '@tobari/schema';

export const InvoiceForm: FormDefinition = {
    title: 'Invoice Calculation Demo',
    version: '1.0.0',
    description: 'A sample form demonstrating dynamic tables and formulas.',
    fields: [
        {
            id: 'customer',
            type: 'text',
            label: 'Customer Name',
            placeholder: 'Enter customer name',
            required: true
        },
        {
            id: 'date',
            type: 'date',
            label: 'Date',
            defaultValue: new Date().toISOString().split('T')[0]
        },
        {
            id: 'items',
            type: 'table',
            label: 'Line Items',
            columns: [
                { id: 'name', type: 'text', label: 'Item Name', placeholder: 'Widget A' },
                { id: 'price', type: 'number', label: 'Unit Price', defaultValue: 0 },
                { id: 'qty', type: 'number', label: 'Quantity', defaultValue: 1 },
                { id: 'subtotal', type: 'calc', label: 'Subtotal', formula: 'price * qty', readonly: true }
            ]
        },
        {
            id: 'taxRate',
            type: 'number',
            label: 'Tax Rate (%)',
            defaultValue: 10
        },
        {
            id: 'subtotal_sum',
            type: 'calc',
            label: 'Subtotal Sum',
            formula: 'SUM(items.subtotal)',
            readonly: true
        },
        {
            id: 'total',
            type: 'calc',
            label: 'Grand Total (inc. Tax)',
            formula: 'subtotal_sum * (1 + taxRate / 100)',
            readonly: true
        }
    ]
};

export const InitialData = {
    customer: 'Acme Corp',
    items: [
        { name: 'Apples', price: 100, qty: 5 },
        { name: 'Oranges', price: 80, qty: 10 }
    ],
    taxRate: 10
};
