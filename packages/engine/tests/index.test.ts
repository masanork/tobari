import { expect, test, describe, mock } from 'bun:test';
import { FormEngine } from '../src/index';
import type { FormDefinition } from '@tobari/schema';

describe('FormEngine (Reactivity)', () => {
    test('should calculate simple formula', () => {
        const schema: FormDefinition = {
            title: 'Calc',
            fields: [
                { id: 'a', type: 'number', defaultValue: 10 },
                { id: 'b', type: 'number', defaultValue: 20 },
                { id: 'sum', type: 'calc', formula: 'a + b' }
            ]
        };
        const engine = new FormEngine(schema);

        expect(engine.getValue('sum')).toBe(30);

        engine.setValue('a', 50);
        expect(engine.getValue('sum')).toBe(70);
    });

    test('should calculate table rows and aggregation', () => {
        const schema: FormDefinition = {
            title: 'Invoice',
            fields: [
                {
                    id: 'items',
                    type: 'table',
                    columns: [
                        { id: 'price', type: 'number' },
                        { id: 'qty', type: 'number' },
                        { id: 'subtotal', type: 'calc', formula: 'price * qty' }
                    ]
                },
                {
                    id: 'total',
                    type: 'calc',
                    formula: 'SUM(items.subtotal)'
                }
            ]
        };

        const initialData = {
            items: [
                { price: 100, qty: 1 },
                { price: 200, qty: 2 }
            ]
        };

        const engine = new FormEngine(schema, initialData);

        // Check initial calculation
        // Row 0: 100 * 1 = 100
        // Row 1: 200 * 2 = 400
        // Total: 100 + 400 = 500

        expect(engine.getValue('items.0.subtotal')).toBe(100);
        expect(engine.getValue('items.1.subtotal')).toBe(400);
        expect(engine.getValue('total')).toBe(500);

        // Update value
        engine.setValue('items.0.qty', 5); // 100 * 5 = 500
        // New Total: 500 + 400 = 900

        expect(engine.getValue('items.0.subtotal')).toBe(500);
        expect(engine.getValue('total')).toBe(900);
    });
});
