# Service Request Tutorial

This tutorial explains how to create an Administrative Request (service_request) using Tobari. It covers the minimum steps to convert an existing manual procedure into a machine-readable Tobari form.

## 1. Directory Structure

Navigate to `examples/service-request/` to see the following files:
- `service-request.yaml`: The schema defining form fields and logic.
- `child-allowance-data.yaml`: Sample data for pre-filling the form.
- `gen-request.ts`: A script to generate the HTML form from the schema.

## 2. Defining the Schema

Open `service-request.yaml`. You will see sections for:
- `meta`: General information about the service (e.g., Service Name, ID).
- `fields`: Input fields like Name, Address, and Date.
- `logic`: (Optional) Visibility rules and validation logic.

## 3. Generating the Form

Run the following command to generate an interactive HTML form:

```bash
bun gen-request.ts
```

This will produce `service-request.html`. This form can be opened in any modern browser.

## 4. Autofill and Signing

Tobari forms support the `autofill` attribute. If a user has a compatible Identity Card (e.g., My Number Card) or a pre-existing credential, they can autofill the form with a single click.

Once the user completes the form, the data is packaged into a machine-readable format (SD-CBOR) and signed on the client side before submission.

## 5. Verification

The verifier (government or service provider) receives the signed package and can verify the authenticity using the Tobari CLI or API.