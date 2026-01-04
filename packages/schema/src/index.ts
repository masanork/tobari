import { z } from 'zod';

// --- Field Types ---

export const FieldTypeSchema = z.enum([
    'text',
    'textarea',
    'number',
    'email',
    'date',
    'select',
    'checkbox',
    'radio',
    'calc',   // Computed field
    'search', // Master search
    'table',  // Dynamic array/table
    'group',  // Logical group
    'hidden'
]);

export type FieldType = z.infer<typeof FieldTypeSchema>;

// --- Validation Rules ---

export const ValidationRuleSchema = z.object({
    type: z.string(), // e.g., 'required', 'min', 'max', 'regex'
    value: z.any().optional(),
    message: z.string().optional()
});

export type ValidationRule = z.infer<typeof ValidationRuleSchema>;

// --- Layout Hints ---

export const LayoutHintSchema = z.object({
    align: z.enum(['left', 'center', 'right']).optional(),
    size: z.enum(['S', 'M', 'L', 'full']).optional(),
    width: z.number().optional(), // Grid columns span
    hidden: z.boolean().optional(),
});

export type LayoutHint = z.infer<typeof LayoutHintSchema>;

// --- Field Definition ---

// Base properties common to all fields
const BaseFieldSchema = z.object({
    id: z.string().min(1),
    type: FieldTypeSchema,
    label: z.string(),
    description: z.string().optional(),
    hint: z.string().optional(), // HTML hint support
    placeholder: z.string().optional(),
    defaultValue: z.any().optional(),

    // State flags
    required: z.boolean().optional(),
    disabled: z.boolean().optional(),
    readonly: z.boolean().optional(), // Distinct from disabled (submittable)

    // Logic
    formula: z.string().optional(), // For 'calc' and others. e.g. "SUM(items.price)"

    // Validation
    validations: z.array(ValidationRuleSchema).optional(),

    // UI Hints
    layout: LayoutHintSchema.optional(),
});

// Specialized properties for different field types
export type FieldDefinition = z.infer<typeof BaseFieldSchema> & {
    options?: { label: string; value: string }[]; // select/radio
    source?: string; // search: master ID
    lookup?: string; // search: column to lookup
    columns?: FieldDefinition[]; // table: column definitions
    children?: FieldDefinition[]; // group: children
};

export const FieldDefinitionSchema: z.ZodType<FieldDefinition> = z.lazy(() =>
    BaseFieldSchema.extend({
        options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
        source: z.string().optional(),
        lookup: z.string().optional(),
        columns: z.array(FieldDefinitionSchema).optional(),
        children: z.array(FieldDefinitionSchema).optional()
    })
);

// --- Master Data ---

export const MasterDataSchema = z.array(z.record(z.any()));
export type MasterData = z.infer<typeof MasterDataSchema>;

// --- Form Definition (Root) ---

export const FormDefinitionSchema = z.object({
    title: z.string(),
    version: z.string().default('1.0.0'),
    meta: z.record(z.any()).optional(),
    masters: z.record(MasterDataSchema).optional(), // { "vendors": [...] }
    fields: z.array(FieldDefinitionSchema)
});

export type FormDefinition = z.infer<typeof FormDefinitionSchema>;
