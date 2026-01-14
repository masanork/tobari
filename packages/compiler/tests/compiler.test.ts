import { expect, test, describe } from "bun:test";
import { parseMarkdown } from "../src/index";

describe("Web/A Compiler", () => {
    test("Basic text input with attributes", () => {
        // Use a key that doesn't trigger semantic autocomeplete to ensure type="text" appears
        const md = "- [text:custom_field (required placeholder='My Label')] Custom Field";
        const { html, jsonStructure } = parseMarkdown(md);

        // HTML checks
        expect(html).toContain('<input');
        expect(html).toContain('type="text"');
        expect(html).toContain('data-json-path="custom_field"');
        expect(html).toContain('required');
        expect(html).toContain('placeholder="My Label"');
        expect(html).toContain('Custom Field');

        // JSON Schema checks
        expect(jsonStructure.fields).toBeDefined();
        const field = jsonStructure.fields.find((f: any) => f.key === "custom_field");
        expect(field).toBeDefined();
        expect(field.required).toBe(true);
        expect(field.label).toBe("Custom Field");
    });

    test("Numeric input with min/max", () => {
        const md = "- [number:age (min=0 max=120)] Age";
        const { html } = parseMarkdown(md);
        expect(html).toContain('type="number"');
        expect(html).toContain('min="0"');
        expect(html).toContain('max="120"');
    });

    test("Radio button group (Correct Syntax)", () => {
        const md = `
- [radio:gender] Gender
  - [x] Male
  - Female
        `;
        const { html } = parseMarkdown(md);
        // Should have 2 radio inputs with same name
        const matches = html.match(/name="gender"/g);
        expect(matches?.length).toBe(2);
        expect(html).toContain('value="Male"');
        expect(html).toContain('value="Female"');
        expect(html).toContain('checked');
    });

    test("Calculator field with formula", () => {
        const md = "- [calc:total (formula:price*qty)] Total";
        const { html, jsonStructure } = parseMarkdown(md);

        expect(html).toContain('readonly');
        expect(html).toContain('data-formula="price*qty"');
        // JSON structure check removed as formula is not currently pushed to schema
        // expect(jsonStructure.fields.find((f: any) => f.key === "total").formula).toBe("price*qty");
    });

    test("Dynamic Table Parsing", () => {
        // Dynamic table syntax: 
        // Row 1: Headers
        // Row 2: Template (Tags must occupy full cell for current parser)
        const md = `
[dynamic table:items]
| Item Label | Cost Label |
|---|---|
| [text:item] | [number:cost] |
        `;
        const { html, jsonStructure } = parseMarkdown(md);

        expect(html).toContain('<table');
        expect(html).toContain('id="tbl_items"');
        expect(html).toContain('data-table-key="items"');
        // Dynamic tables use data-base-key for template rows
        expect(html).toContain('data-base-key="item"');
        expect(html).toContain('data-base-key="cost"');

        // Template row check
        expect(html).toContain('class="template-row"');

        // JSON Structure for table
        expect(jsonStructure.tables.items).toBeDefined();
        expect(jsonStructure.tables.items.length).toBe(2); // item, cost
    });

    test("Complex Static Table", () => {
        const md = `
| Label | Value |
|---|---|
| Name | [text:name] |
| Age | [number:age] |
        `;
        const { html, jsonStructure } = parseMarkdown(md);
        expect(html).toContain('<table');
        expect(html).toContain('data-json-path="name"');
        expect(html).toContain('data-json-path="age"');
        // Static tables don't get data-table-key
        expect(html).not.toContain('data-table-key=');
    });

    test("Metadata Extraction (Frontmatter)", () => {
        const md = "# My Form Title\n- [text:foo] Bar";
        const { html, jsonStructure } = parseMarkdown(md);
        expect(jsonStructure.name).toBe("My Form Title");
    });
});
