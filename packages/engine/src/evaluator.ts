import { resolveReferences } from './utils/path';

type TokenType = 'NUMBER' | 'STRING' | 'IDENTIFIER' | 'OP' | 'LPAREN' | 'RPAREN' | 'COMMA';

interface Token {
    type: TokenType;
    value: string;
}

export class FormulaEvaluator {
    private context: any;

    constructor(context: any = {}) {
        this.context = context;
    }

    evaluate(formula: string, context?: any): any {
        if (context) this.context = context;
        if (!formula) return null;
        if (typeof formula !== 'string') return formula;

        const tokens = this.tokenize(formula);
        const parser = new Parser(tokens, this.context);
        return parser.parse();
    }
}

class Parser {
    private tokens: Token[];
    private pos: number = 0;
    private context: any;

    constructor(tokens: Token[], context: any) {
        this.tokens = tokens;
        this.context = context;
    }

    parse(): any {
        const result = this.parseExpression();
        if (this.pos < this.tokens.length) {
            throw new Error('Unexpected token at end of formula');
        }
        return result;
    }

    // Expression: Term { (+|-) Term }
    private parseExpression(): any {
        let left = this.parseTerm();

        while (this.match('OP', '+') || this.match('OP', '-')) {
            const op = this.consume().value;
            const right = this.parseTerm();
            if (op === '+') left += right;
            if (op === '-') left -= right;
        }
        return left;
    }

    // Term: Factor { (*|/) Factor }
    private parseTerm(): any {
        let left = this.parseFactor();

        while (this.match('OP', '*') || this.match('OP', '/')) {
            const op = this.consume().value;
            const right = this.parseFactor();
            if (op === '*') left *= right;
            if (op === '/') left /= right;
        }
        return left;
    }

    // Factor: Number | String | Identifier | Function | ( Expression )
    private parseFactor(): any {
        if (this.match('NUMBER')) {
            return parseFloat(this.consume().value);
        }
        if (this.match('STRING')) {
            return this.consume().value.slice(1, -1); // Remove quotes
        }
        if (this.match('LPAREN')) {
            this.consume();
            const expr = this.parseExpression();
            if (!this.match('RPAREN')) throw new Error('Expected )');
            this.consume();
            return expr;
        }
        if (this.match('IDENTIFIER')) {
            const id = this.consume().value;
            if (this.match('LPAREN')) {
                // Function Call
                return this.parseFunctionCall(id);
            } else {
                // Variable
                return this.resolveVariable(id);
            }
        }
        throw new Error(`Unexpected token: ${this.tokens[this.pos]?.value}`);
    }

    private parseFunctionCall(funcName: string): any {
        this.consume(); // (
        const args = [];
        if (!this.match('RPAREN')) {
            do {
                args.push(this.parseExpression());
            } while (this.match('COMMA') && this.consume());
        }
        if (!this.match('RPAREN')) throw new Error('Expected )');
        this.consume();

        switch (funcName.toUpperCase()) {
            case 'SUM':
                return this.funcSum(args);
            case 'AVG':
                return this.funcAvg(args);
            case 'IF':
                return args[0] ? args[1] : args[2];
            default:
                throw new Error(`Unknown function: ${funcName}`);
        }
    }

    private resolveVariable(path: string): any {
        // Basic resolving + simple aggregation support
        // e.g. "field" or "table.field"
        return resolveReferences(this.context, path) ?? 0;
    }

    // --- Functions ---

    private funcSum(args: any[]): number {
        // Flatten array if aggregation was passed as a single arg
        const flattened = args.flat();
        return flattened.reduce((acc, val) => acc + (Number(val) || 0), 0);
    }

    private funcAvg(args: any[]): number {
        const flattened = args.flat();
        if (flattened.length === 0) return 0;
        return this.funcSum(flattened) / flattened.length;
    }

    // --- Helpers ---

    private match(type: TokenType, value?: string): boolean {
        const token = this.tokens[this.pos];
        if (!token) return false;
        if (token.type !== type) return false;
        if (value && token.value !== value) return false;
        return true;
    }

    private consume(): Token {
        return this.tokens[this.pos++];
    }
}

// Simple Lexer
FormulaEvaluator.prototype['tokenize'] = function (expr: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < expr.length) {
        const char = expr[i];

        if (/\s/.test(char)) { i++; continue; }

        if (/[0-9]/.test(char)) {
            let num = '';
            while (i < expr.length && /[0-9.]/.test(expr[i])) num += expr[i++];
            tokens.push({ type: 'NUMBER', value: num });
            continue;
        }

        if (/[a-zA-Z_]/.test(char)) {
            let id = '';
            while (i < expr.length && /[a-zA-Z0-9_.]/.test(expr[i])) id += expr[i++];
            tokens.push({ type: 'IDENTIFIER', value: id });
            continue;
        }

        if (['+', '-', '*', '/'].includes(char)) {
            tokens.push({ type: 'OP', value: char });
            i++; continue;
        }

        if (char === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue; }
        if (char === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue; }
        if (char === ',') { tokens.push({ type: 'COMMA', value: ',' }); i++; continue; }

        if (char === '"' || char === "'") {
            const quote = char;
            i++;
            let str = '';
            while (i < expr.length && expr[i] !== quote) str += expr[i++];
            i++; // skip closing quote
            tokens.push({ type: 'STRING', value: str });
            continue;
        }

        throw new Error(`Unknown char: ${char}`);
    }
    return tokens;
}
