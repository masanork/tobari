
export class Calculator {

    // Auto-Copy is intimately tied to calculation cycles
    public runAutoCopy() {
        document.querySelectorAll('[data-copy-from]').forEach((dest: any) => {
            // Only copy if destination hasn't been manually edited (dirty)
            if (!dest.dataset.dirty) {
                const srcKey = dest.dataset.copyFrom;
                if (srcKey) {
                    // Find source (scoped to row if destination is in row)
                    const row = dest.closest('tr');
                    const scope = row || document;
                    const src = scope.querySelector(`[data-base-key="${srcKey}"], [data-json-path="${srcKey}"]`) as HTMLInputElement;

                    if (src && src.value !== dest.value) {
                        dest.value = src.value;
                        // Trigger input to propagate
                        dest.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            }
        });
    }

    public recalculate() {
        document.querySelectorAll('[data-formula]').forEach((calcField: any) => {
            const formula = calcField.dataset.formula;
            if (!formula) return;
            const row = calcField.closest('tr');
            const table = calcField.closest('table');

            const getValue = (varName: string) => {
                let val = 0;
                let foundSource = 'none';
                // let rawVal = ''; // Unused in logic but present in original

                if (row) {
                    const selector = `[data-base-key="${varName}"], [data-json-path="${varName}"]`;
                    const input = row.querySelector(selector) as HTMLInputElement;
                    if (input) {
                        foundSource = 'row-input';
                        // rawVal = input.value;
                        if (input.value !== '') val = parseFloat(input.value);
                    }
                }

                if (foundSource === 'none') {
                    const staticInput = document.querySelector(`[data-json-path="${varName}"]`) as HTMLInputElement;
                    if (staticInput) {
                        foundSource = 'static-input';
                        // rawVal = staticInput.value;
                        if (staticInput.value !== '') val = parseFloat(staticInput.value);
                    }
                }

                return val;
            };

            let evalStr = formula.replace(/SUM\(([a-zA-Z0-9_\-\u0080-\uFFFF]+)\)/g, (_: any, key: string) => {
                let sum = 0;
                const scope = table || document;
                let inputs = scope.querySelectorAll(`[data-base-key="${key}"], [data-json-path="${key}"]`);
                if (inputs.length === 0 && scope !== document) {
                    inputs = document.querySelectorAll(`[data-base-key="${key}"], [data-json-path="${key}"]`);
                }
                inputs.forEach((inp: any) => {
                    const val = parseFloat(inp.value);
                    if (!isNaN(val)) sum += val;
                });
                return sum;
            });

            // Match vars (non-digits/operators/paren) to replace with getValue(var)
            evalStr = evalStr.replace(/([a-zA-Z_\u0080-\uFFFF][a-zA-Z0-9_\-\u0080-\uFFFF]*)/g, (match: string) => {
                if (['Math', 'round', 'floor', 'ceil', 'abs', 'min', 'max'].includes(match)) return match;
                return String(getValue(match));
            });

            try {
                // Use Function constructor for eval
                // It's safe-ish here because we are client-side and input is from attributes derived from md
                const result = new Function('return ' + evalStr)();
                if (typeof result === 'number' && !isNaN(result)) {
                    calcField.value = Number.isInteger(result) ? result : result.toFixed(0);
                } else {
                    calcField.value = '';
                }
            } catch (e) {
                console.error("Calc Error:", e);
                calcField.value = 'Err';
            }
        });

        // Run AutoCopy AFTER calculation
        this.runAutoCopy();
    }
}
