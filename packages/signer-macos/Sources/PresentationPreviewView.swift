import SwiftUI

/// Preview view for Verifiable Presentation before signing
struct PresentationPreviewView: View {
    let mdoc: MdocDocument
    let disclosedFields: [String]
    let verifierId: String?
    let onApprove: () -> Void
    let onCancel: () -> Void

    @State private var isProcessing = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 8) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 48))
                    .foregroundColor(.blue)

                Text("Presentation Preview")
                    .font(.title2)
                    .fontWeight(.semibold)

                if let verifier = verifierId {
                    Text("Requested by: \(verifier)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.top, 24)
            .padding(.bottom, 16)

            Divider()

            // Document Info
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Document Type")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                    Text(formatDocType(mdoc.docType))
                        .font(.caption)
                        .fontWeight(.medium)
                }

                Divider()

                Text("Fields to be Disclosed")
                    .font(.headline)
                    .padding(.top, 8)

                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(getAllFieldsWithStatus(), id: \.field) { item in
                            FieldRow(
                                name: item.displayName,
                                value: item.value,
                                disclosed: item.disclosed
                            )
                        }
                    }
                }
                .frame(maxHeight: 300)
            }
            .padding(16)

            Divider()

            // Warning
            HStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(.orange)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Important")
                        .font(.caption)
                        .fontWeight(.semibold)

                    Text("Disclosed fields will be shared with the requesting party. Non-disclosed fields remain private.")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .padding(12)
            .background(Color.orange.opacity(0.1))
            .cornerRadius(8)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            // Action Buttons
            HStack(spacing: 12) {
                Button(action: {
                    onCancel()
                }) {
                    Text("Cancel")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.bordered)
                .disabled(isProcessing)

                Button(action: {
                    isProcessing = true
                    onApprove()
                }) {
                    HStack {
                        if isProcessing {
                            ProgressView()
                                .scaleEffect(0.8)
                                .padding(.trailing, 4)
                        }
                        Text(isProcessing ? "Signing..." : "Approve & Sign")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isProcessing)
            }
            .padding(16)
        }
        .frame(width: 500, height: 600)
    }

    // MARK: - Helper Functions

    private func getAllFieldsWithStatus() -> [(field: String, displayName: String, value: String, disclosed: Bool)] {
        var result: [(String, String, String, Bool)] = []

        for field in mdoc.getAllFields() {
            let displayName = mdoc.getFieldDisplayName(field)
            let value = mdoc.getFieldValue(field)
            let disclosed = disclosedFields.contains(field) ||
                            disclosedFields.contains(where: { $0.split(separator: ".").last == field.split(separator: ".").last })

            result.append((field, displayName, value, disclosed))
        }

        // Sort: disclosed first, then alphabetically
        return result.sorted { item1, item2 in
            if item1.3 != item2.3 {
                return item1.3
            }
            return item1.1 < item2.1
        }
    }

    private func formatDocType(_ docType: String) -> String {
        if docType.contains("mDL") || docType.contains("driving") {
            return "Driver's License"
        } else if docType.contains("resident") || docType.contains("juminhyo") {
            return "Resident Record"
        } else if docType.contains("passport") {
            return "Passport"
        }
        return docType.components(separatedBy: ".").last ?? docType
    }
}

/// Row displaying a single field
struct FieldRow: View {
    let name: String
    let value: String
    let disclosed: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Disclosure indicator
            Image(systemName: disclosed ? "checkmark.circle.fill" : "eye.slash.fill")
                .foregroundColor(disclosed ? .green : .gray)
                .font(.system(size: 20))
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 4) {
                Text(name)
                    .font(.subheadline)
                    .fontWeight(.medium)

                if disclosed {
                    Text(value.isEmpty ? "(empty)" : value)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                } else {
                    Text("(hidden)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .italic()
                }
            }

            Spacer()
        }
        .padding(12)
        .background(disclosed ? Color.green.opacity(0.05) : Color.gray.opacity(0.05))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(disclosed ? Color.green.opacity(0.3) : Color.gray.opacity(0.2), lineWidth: 1)
        )
    }
}

// MARK: - Preview Provider

struct PresentationPreviewView_Previews: PreviewProvider {
    static var previews: some View {
        PresentationPreviewView(
            mdoc: MdocDocument(
                docType: "org.iso.18013.5.1.mDL",
                nameSpaces: [
                    "org.iso.18013.5.1": [
                        "family_name": "Yamada",
                        "given_name": "Taro",
                        "birth_date": "1990-01-01",
                        "issue_date": "2020-01-01"
                    ]
                ]
            ),
            disclosedFields: ["org.iso.18013.5.1.family_name", "org.iso.18013.5.1.given_name"],
            verifierId: "example.com",
            onApprove: {},
            onCancel: {}
        )
    }
}
