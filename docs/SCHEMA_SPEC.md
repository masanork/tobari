# Tobari Schema Specification

This document outlines the capabilities and structure of the Tobari Form Schema.
The schema is designed to support complex administrative forms (e.g., government applications) with rich interactivity, purely via configuration.

## 1. Field System

Fields are the building blocks of a form.

### Basic Types
*   **`text`**: Single line text input.
*   **`textarea`**: Multi-line text input. Supports rich hints (HTML).
*   **`number`**: Numeric input.
*   **`date`**: Date picker.
*   **`select`**: Dropdown menu. Can be static or dynamic (master-based).
*   **`radio`**: Radio button group.
*   **`checkbox`**: Checkbox (single or group).

### Specialized Types
*   **`calc`**: Read-only field that displays the result of a formula.
*   **`search`**: Autocomplete/Search input connected to a Master Datasource.
*   **`hidden`**: Field not visible to the user but holds data (e.g., IDs, calculated intermediates).

### Common Properties (Metadata)
*   `id` (Required): Unique identifier for the field in the data model.
*   `label`: Human-readable label.
*   `hint`: Helper text (HTML allowed).
*   `placeholder`: Input placeholder.
*   `align`: Visual alignment hint (`left`, `center`, `right`).
*   `size`: Visual size hint (`S`, `M`, `L`, `full`).

## 2. Reactivity & Logic

Tobari Engine treats the form as a spreadsheet-like dependency graph.

### Formula
*   **Property**: `formula`
*   **Description**: An expression string evaluated to produce the field's value.
*   **Syntax**: Close to Excel or simplified JS.
    *   Variables: `{{field_id}}` or just `field_id`.
    *   Functions: `SUM()`, `AVG()`, `IF()`, `ROUND()`, etc.
    *   Operators: `+`, `-`, `*`, `/`.
*   **Example**: `k1_r8 - k1_base`

### Auto-fill & Lookup
*   **Property**: `autofill` (on `search` fields target) or `lookup` (on target fields).
*   **Description**: When a `search` field is selected, populate other fields with corresponding data from the Master record.

## 3. Data Structure & Grouping

### Groups
*   **Type**: `group`
*   **Usage**: Logical grouping for validation or UI layout.
*   **Children**: Contains a list of `fields`.

### Dynamic Tables (Arrays)
*   **Type**: `table` (or `array`)
*   **Usage**: A list of items that users can add/remove rows from.
*   **Properties**:
    *   `columns`: Definitions of fields found in each row.
*   **Aggregation**: Formulas outside the table must be able to aggregate table columns (e.g., `SUM(expense_details.amount)`).

### Layout (UI Hints)
*   Schema focuses on *Data Structure*, but includes *Layout Hints*.
*   **Grid**: `layout: { type: 'grid', columns: 2 }`

## 4. Master Data (Datasources)

The form definition can include static master data tables.

*   **Property**: `masters` (Root level)
*   **Structure**: A dictionary of datasets.
    *   Key: Master ID (e.g., `vendors`).
    *   Value: Array of records (JSON objects).

## 5. JSON Structure Example

```json
{
  "title": "System Optimization Plan",
  "masters": {
    "vendors": [
      { "id": "1", "name": "Vendor A", "pref": "Tokyo" },
      { "id": "2", "name": "Vendor B", "pref": "Osaka" }
    ]
  },
  "fields": [
    {
      "id": "vendor_id",
      "type": "search",
      "source": "vendors",
      "label": "Vendor Name"
    },
    {
      "id": "vendor_pref",
      "type": "text",
      "label": "Prefecture",
      "formula": "LOOKUP(vendor_id, 'vendors', 'pref')"
    },
    {
      "id": "items",
      "type": "table",
      "columns": [
        { "id": "price", "type": "number" },
        { "id": "quantity", "type": "number" },
        { "id": "subtotal", "type": "calc", "formula": "price * quantity" }
      ]
    },
    {
      "id": "grand_total",
      "type": "calc",
      "formula": "SUM(items.subtotal)"
    }
  ]
}
```
