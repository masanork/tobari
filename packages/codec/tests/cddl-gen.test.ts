import { expect, test, describe } from "bun:test";
import { yamlToCddl } from "../src/cddl-gen";

describe("CDDL Generator", () => {
    test("should convert simple string fields", () => {
        const yaml = `
id: "test.v1"
title: "Test Schema"
fields:
  - id: "name"
    type: "string"
`;
        const cddl = yamlToCddl(yaml);
        expect(cddl).toContain('"name" => tstr');
    });

    test("should handle selective disclosure flags", () => {
        const yaml = `
id: "test.v1"
title: "Test Schema"
fields:
  - id: "address"
    type: "string"
    selective: true
`;
        const cddl = yamlToCddl(yaml);
        expect(cddl).toContain('"address" => tstr, ; selective');
    });

    test("should handle nested arrays and fields", () => {
        const yaml = `
id: "test.v1"
title: "Test Schema"
fields:
  - id: "items"
    type: "array"
    items:
      fields:
        - id: "sub"
          type: "string"
`;
        const cddl = yamlToCddl(yaml);
        expect(cddl).toContain('"items" => [* {');
        expect(cddl).toContain('"sub" => tstr');
    });
});
