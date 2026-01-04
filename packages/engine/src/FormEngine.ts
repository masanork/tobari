import { type FormDefinition, type FieldDefinition } from '@tobari/schema';
import { FormulaEvaluator } from './evaluator';
import { getIn, setIn } from './utils/path';

type FormValues = Record<string, any>;
type FormErrors = Record<string, string[]>;
type Listener = (state: FormState) => void;

export interface FormState {
    values: FormValues;
    errors: FormErrors;
    isValid: boolean;
    isSubmitting: boolean;
}

export class FormEngine {
    private schema: FormDefinition;
    private state: FormState;
    private listeners: Set<Listener> = new Set();
    private evaluator: FormulaEvaluator;

    constructor(schema: FormDefinition, initialValues: FormValues = {}) {
        this.schema = schema;
        this.state = {
            values: structuredClone(initialValues),
            errors: {},
            isValid: true,
            isSubmitting: false,
        };
        this.evaluator = new FormulaEvaluator(this.state.values);

        this.initializeDefaults(this.schema.fields);
        // Initial calculation
        this.recalculateAll();
    }

    private initializeDefaults(fields: FieldDefinition[]) {
        // Very basic initialization. 
        // For arrays/tables, we might need to rely on explicit setValue or pre-filled data.
        fields.forEach(field => {
            if (field.defaultValue !== undefined && getIn(this.state.values, field.id) === undefined) {
                setIn(this.state.values, field.id, field.defaultValue);
            }
            if (field.children) this.initializeDefaults(field.children);
        });
    }

    // --- State Access ---

    getState(): FormState {
        return structuredClone(this.state);
    }

    getValue(path: string): any {
        return getIn(this.state.values, path);
    }

    // --- Actions ---

    setValue(path: string, value: any) {
        if (getIn(this.state.values, path) === value) return;

        setIn(this.state.values, path, value);

        // Trigger Reactivity
        this.recalculateAll();

        this.validateField(path);
        this.notify();
    }

    // --- Reactivity ---

    private recalculateAll() {
        // Naive implementation: iterate all fields with formula and re-evaluate.
        // In a real app, we should use a dependency graph.
        // We do multiple passes to resolve dependencies (or just one pass if ordered correctly).
        // For now, one pass, assuming standard order or simple dependencies.

        const calcFields = this.collectCalcFields(this.schema.fields);

        // Update evaluator context
        this.evaluator = new FormulaEvaluator(this.state.values);

        for (const field of calcFields) {
            if (field.formula) {
                try {
                    const result = this.evaluator.evaluate(field.formula);
                    setIn(this.state.values, field.id, result);
                } catch (e) {
                    console.warn(`Formula error in ${field.id}:`, e);
                }
            }
        }
    }

    private collectCalcFields(fields: FieldDefinition[]): FieldDefinition[] {
        let results: FieldDefinition[] = [];
        for (const field of fields) {
            if (field.formula) results.push(field);
            if (field.children) results = results.concat(this.collectCalcFields(field.children));
            // Table columns
            if (field.type === 'table' && field.columns) {
                // For tables, formulas are usually row-based (e.g. price * qty).
                // We need to iterate over *data rows* to apply formulas, not just definition.
                this.recalculateOpsForTable(field);
            }
        }
        return results;
    }

    private recalculateOpsForTable(tableField: FieldDefinition) {
        if (!tableField.columns) return;

        const rows = getIn(this.state.values, tableField.id);
        if (!Array.isArray(rows)) return;

        // Identify columns with formulas
        const calcCols = tableField.columns.filter(c => c.formula);
        if (calcCols.length === 0) return;

        rows.forEach((row, index) => {
            // Create a row context + global context for evaluation
            // Ideally, we merge global values and row values. 
            // row properties should take precedence or be accessed directly?
            // Spec: "price * quantity". Usually implies local row scope.

            const rowContext = { ...row, ...this.state.values }; // Simple merge
            const rowEvaluator = new FormulaEvaluator(rowContext);

            calcCols.forEach(col => {
                if (col.formula) {
                    try {
                        const val = rowEvaluator.evaluate(col.formula);
                        // Set back to state
                        const path = `${tableField.id}.${index}.${col.id}`;
                        setIn(this.state.values, path, val);
                        // Update row object for next calculations in same row
                        row[col.id] = val;
                    } catch (e) { /* ignore */ }
                }
            });
        });
    }

    // --- Validation (Placeholder) ---

    validateField(path: string) {
        // TODO: proper validation
        delete this.state.errors[path];
    }

    validate(): boolean {
        // TODO
        return true;
    }

    // --- Subscription ---

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify() {
        this.listeners.forEach((listener) => listener(this.getState()));
    }
}
