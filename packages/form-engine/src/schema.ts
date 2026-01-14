import { z } from 'zod';

// Core Field Types
export const FieldTypeSchema = z.enum(['text', 'integer', 'group', 'select', 'array', 'textarea', 'static_table']);

// Base attributes common to all fields
const BaseFieldSchema = z.object({
    key: z.string().regex(/^[a-z0-9_]+$/, "Key must be snake_case"),
    label: z.string().optional(),
    required: z.boolean().default(false),
    description: z.string().optional(),
    hidden: z.boolean().default(false),
    readonly: z.boolean().default(false),
    autofill: z.string().optional(), // format: "targetKey:sourceIndex,..." or "postal"
    masterSrc: z.string().optional(), // key of masterData table
    masterValueIndex: z.number().optional(), // 1-based index of value column
    masterLabelIndex: z.number().optional(), // 1-based index of label column
    formula: z.string().optional(), // formula expression for calculated fields
});

// --- Specific Field Definitions ---

export const TextFieldSchema = BaseFieldSchema.extend({
    type: z.literal('text'),
    placeholder: z.string().optional(),
    pattern: z.string().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
});

export const TextareaFieldSchema = BaseFieldSchema.extend({
    type: z.literal('textarea'),
    placeholder: z.string().optional(),
    rows: z.number().optional(),
});

export const IntegerFieldSchema = BaseFieldSchema.extend({
    type: z.literal('integer'),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().default(1),
    autonum: z.boolean().optional(),
});

export const SelectFieldSchema = BaseFieldSchema.extend({
    type: z.literal('select'),
    options: z.array(z.tuple([z.string(), z.string()])).describe("Array of [value, label] tuples"),
});

// Recursive schema for Groups (using z.lazy for recursion)
export const GroupFieldSchema: z.ZodType<any> = BaseFieldSchema.extend({
    type: z.literal('group'),
    fields: z.lazy(() => z.array(FormElementSchema)),
});

export const ArrayFieldSchema: z.ZodType<any> = BaseFieldSchema.extend({
    type: z.literal('array'),
    itemSchema: z.lazy(() => FormElementSchema),
    minItems: z.number().default(0),
    maxItems: z.number().optional(),
});

// Static Table: A grid of fixed rows/cols, some cells contain fields, others text
export const StaticTableFieldSchema: z.ZodType<any> = BaseFieldSchema.extend({
    type: z.literal('static_table'),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.union([
        z.string(), // Static text cell
        z.lazy(() => FormElementSchema) // Field cell
    ])))
});

// Union of all field types
export const FormElementSchema = z.discriminatedUnion('type', [
    TextFieldSchema,
    TextareaFieldSchema,
    IntegerFieldSchema,
    SelectFieldSchema,
    GroupFieldSchema,
    ArrayFieldSchema,
    StaticTableFieldSchema,
]);

// Top-level Form Definition
export const FormDefinitionSchema = z.object({
    meta: z.object({
        title: z.string(),
        version: z.string().default("1.0"),
        security: z.enum(['standard', 'high', 'offline']).default('standard'),
    }),
    fields: z.array(FormElementSchema),
    masterData: z.record(z.array(z.array(z.string()))).optional(),
});

// Types inferred from Zod
export type FormDefinition = z.infer<typeof FormDefinitionSchema>;
export type FormElement = z.infer<typeof FormElementSchema>;
export type TextField = z.infer<typeof TextFieldSchema>;
export type TextareaField = z.infer<typeof TextareaFieldSchema>;
export type IntegerField = z.infer<typeof IntegerFieldSchema>;
export type SelectField = z.infer<typeof SelectFieldSchema>;
export type GroupField = z.infer<typeof GroupFieldSchema>;
export type ArrayField = z.infer<typeof ArrayFieldSchema>;
export type StaticTableField = z.infer<typeof StaticTableFieldSchema>;
