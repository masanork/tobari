import { expect, test, describe } from 'bun:test';
import { FormDefinitionSchema, type FormDefinition } from '../src/index';

describe('FormDefinitionSchema (v2)', () => {
    test('should validate basic form', () => {
        const validForm: FormDefinition = {
            title: 'Simple Form',
            fields: [{ id: 'name', type: 'text', label: 'Name' }]
        };
        const result = FormDefinitionSchema.safeParse(validForm);
        expect(result.success).toBe(true);
    });

    test('should validate dynamic table with calculation', () => {
        const tableForm: FormDefinition = {
            title: 'Invoice',
            fields: [
                {
                    id: 'items',
                    type: 'table',
                    label: 'Item List',
                    columns: [
                        { id: 'price', type: 'number', label: 'Price' },
                        { id: 'qty', type: 'number', label: 'Quantity' },
                        { id: 'subtotal', type: 'calc', label: 'Subtotal' } // New 'calc' type
                    ]
                },
                {
                    id: 'total',
                    type: 'calc',
                    label: 'Total',
                    formula: 'SUM(items.subtotal)' // Formula property
                }
            ]
        };
        const result = FormDefinitionSchema.safeParse(tableForm);
        expect(result.success).toBe(true);
    });

    test('should validate master data structure', () => {
        const masterForm: FormDefinition = {
            title: 'Master Form',
            masters: {
                vendors: [
                    { id: '1', name: 'Vendor A' },
                    { id: '2', name: 'Vendor B' }
                ]
            },
            fields: [
                { id: 'vendor', type: 'search', label: 'Vendor', source: 'vendors' }
            ]
        };
        const result = FormDefinitionSchema.safeParse(masterForm);
        expect(result.success).toBe(true);
    });
});
