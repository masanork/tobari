import { expect, test, describe } from "bun:test";
import { extractFieldsFromDefinition, parseOid4vpRequest, type PresentationDefinition } from "./presentation-exchange";

describe("Presentation Exchange Parser", () => {
  describe("extractFieldsFromDefinition", () => {
    test("extracts simple fields from standard mDoc paths", () => {
      const pd: PresentationDefinition = {
        id: "test-1",
        input_descriptors: [{
          id: "desc-1",
          constraints: {
            fields: [
              { path: ["$.mdoc.org.iso.18013.5.1.family_name"] },
              { path: ["$.mdoc.org.iso.18013.5.1.birth_date"] }
            ]
          }
        }]
      };

      const fields = extractFieldsFromDefinition(pd);
      expect(fields).toEqual(["family_name", "birth_date"]);
    });

    test("handles flat paths", () => {
      const pd: PresentationDefinition = {
        id: "test-2",
        input_descriptors: [{
          id: "desc-2",
          constraints: {
            fields: [
              { path: ["$.name"] },
              { path: ["$.age"] }
            ]
          }
        }]
      };

      const fields = extractFieldsFromDefinition(pd);
      expect(fields).toEqual(["name", "age"]);
    });

    test("removes array indexing notation", () => {
      const pd: PresentationDefinition = {
        id: "test-3",
        input_descriptors: [{
          id: "desc-3",
          constraints: {
            fields: [
              { path: ["$.driving_privileges[0].vehicle_category_code"] }
            ]
          }
        }]
      };

      const fields = extractFieldsFromDefinition(pd);
      expect(fields).toEqual(["vehicle_category_code"]);
    });

    test("deduplicates fields", () => {
      const pd: PresentationDefinition = {
        id: "test-4",
        input_descriptors: [{
          id: "desc-4",
          constraints: {
            fields: [
              { path: ["$.mdoc.org.iso.18013.5.1.family_name"] },
              { path: ["$.another.namespace.family_name"] }
            ]
          }
        }]
      };

      const fields = extractFieldsFromDefinition(pd);
      expect(fields).toEqual(["family_name"]);
    });

    test("handles multiple input descriptors", () => {
      const pd: PresentationDefinition = {
        id: "test-5",
        input_descriptors: [
          {
            id: "desc-5a",
            constraints: { fields: [{ path: ["$.a"] }] }
          },
          {
            id: "desc-5b",
            constraints: { fields: [{ path: ["$.b"] }] }
          }
        ]
      };

      const fields = extractFieldsFromDefinition(pd);
      expect(fields).toEqual(["a", "b"]);
    });
  });

  describe("parseOid4vpRequest", () => {
    test("parses flat OID4VP request", () => {
      const json = {
        client_id: "client-1",
        nonce: "nonce-1",
        response_uri: "https://example.com",
        presentation_definition: { id: "pd-1", input_descriptors: [] }
      };

      const parsed = parseOid4vpRequest(json);
      expect(parsed.clientId).toBe("client-1");
      expect(parsed.nonce).toBe("nonce-1");
      expect(parsed.responseUri).toBe("https://example.com");
      expect(parsed.definition?.id).toBe("pd-1");
    });

    test("parses nested request_payload", () => {
      const json = {
        request_payload: {
            presentation_definition: { id: "pd-nested", input_descriptors: [] }
        },
        nonce: "nonce-2"
      };

      const parsed = parseOid4vpRequest(json);
      expect(parsed.nonce).toBe("nonce-2");
      expect(parsed.definition?.id).toBe("pd-nested");
    });

    test("returns undefined for missing definition", () => {
      const json = { nonce: "nonce-3" };
      const parsed = parseOid4vpRequest(json);
      expect(parsed.definition).toBeUndefined();
      expect(parsed.nonce).toBe("nonce-3");
    });
  });
});
