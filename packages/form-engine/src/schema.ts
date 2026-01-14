import { z } from 'zod';

// Core Field Types
export const FieldTypeSchema = z.enum(['text', 'integer', 'group', 'select']);

// Base attributes common to all fields
const BaseFieldSchema = z.object({
    key: z.string().regex(/^[a-z0-9_]+$/, "Key must be snake_case"),
    label: z.string().optional(),
    required: z.boolean().default(false),
    description: z.string().optional(),
    hidden: z.boolean().default(false),
});

// --- Specific Field Definitions ---

export const TextFieldSchema = BaseFieldSchema.extend({
    type: z.literal('text'),
    placeholder: z.string().optional(),
    pattern: z.string().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
});

export const IntegerFieldSchema = BaseFieldSchema.extend({
    type: z.literal('integer'),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().default(1),
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

// Union of all field types
export const FormElementSchema = z.discriminatedUnion('type', [
    TextFieldSchema,
    IntegerFieldSchema,
    SelectFieldSchema,
    GroupFieldSchema,
]);

// Top-level Form Definition
export const FormDefinitionSchema = z.object({
    meta: z.object({
        title: z.string(),
        version: z.string().default("1.0"),
        security: z.enum(['standard', 'high', 'offline']).default('standard'),
    }),
    fields: z.array(FormElementSchema),
});

// Types inferred from Zod
export type FormDefinition = z.infer<typeof FormDefinitionSchema>;
export type FormElement = z.infer<typeof FormElementSchema>;
export type TextField = z.infer<typeof TextFieldSchema>;
export type IntegerField = z.infer<typeof IntegerFieldSchema>;
export type SelectField = z.infer<typeof SelectFieldSchema>;
export type GroupField = z.infer<typeof GroupFieldSchema>;
