import SwiftUI

struct CredentialDetailView: View {
    let mdoc: MdocDocument
    let filename: String
    @Environment(\.dismiss) var dismiss

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(formatDocType(mdoc.docType))
                        .font(.title2)
                        .fontWeight(.bold)
                    Text(filename)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Button(action: { dismiss() }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding()
            .background(Color(NSColor.windowBackgroundColor))

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Face Photo Section
                    if let photoData = mdoc.getFacePhoto(), let image = NSImage(data: photoData) {
                        HStack {
                            Spacer()
                            Image(nsImage: image)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(height: 200)
                                .cornerRadius(12)
                                .shadow(radius: 4)
                                .padding(.vertical)
                            Spacer()
                        }
                    }

                    // Content Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Identity Data")
                            .font(.headline)
                            .padding(.horizontal)

                        let inspection = mdoc.inspect()
                        if let fields = inspection["fields"] as? [String: Any] {
                            ForEach(fields.keys.sorted(), id: \.self) { ns in
                                NamespaceView(name: ns, content: fields[ns] ?? [:])
                            }
                        }
                    }
                }
                .padding(.vertical)
            }
        }
        .frame(minWidth: 500, minHeight: 600)
    }

    private func formatDocType(_ docType: String) -> String {
        if docType.contains("mDL") { return "Driver's License" }
        if docType.contains("passport") { return "Passport" }
        if docType.contains("resident") { return "Resident Record" }
        return docType.components(separatedBy: ".").last ?? docType
    }
}

struct NamespaceView: View {
    let name: String
    let content: Any

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(name)
                .font(.caption)
                .fontWeight(.bold)
                .foregroundColor(.blue)
                .padding(.horizontal)
            
            if let dict = content as? [String: Any] {
                VStack(spacing: 1) {
                    ForEach(dict.keys.sorted(), id: \.self) { key in
                        FieldRowView(label: key, value: dict[key] ?? "")
                    }
                }
                .background(Color.primary.opacity(0.05))
                .cornerRadius(8)
                .padding(.horizontal)
            } else {
                Text("\(String(describing: content))")
                    .padding(.horizontal)
            }
        }
        .padding(.bottom, 8)
    }
}

struct FieldRowView: View {
    let label: String
    let value: Any

    var body: some View {
        HStack(alignment: .top) {
            Text(formatLabel(label))
                .font(.subheadline)
                .foregroundColor(.secondary)
                .frame(width: 120, alignment: .leading)
            
            Spacer()
            
            VStack(alignment: .trailing) {
                if let stringValue = value as? String {
                    if stringValue.count > 100 {
                        Text(stringValue.prefix(100) + "...")
                            .font(.subheadline)
                            .multilineTextAlignment(.trailing)
                    } else {
                        Text(stringValue)
                            .font(.subheadline)
                            .fontWeight(.medium)
                    }
                } else if let dict = value as? [String: Any] {
                    // Recursive call for nested objects
                    ForEach(dict.keys.sorted(), id: \.self) { k in
                        HStack {
                            Text(k).font(.caption).foregroundColor(.secondary)
                            Text("\(String(describing: dict[k] ?? ""))").font(.caption)
                        }
                    }
                } else {
                    Text("\(String(describing: value))")
                        .font(.subheadline)
                }
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(Color(NSColor.controlBackgroundColor))
    }

    private func formatLabel(_ label: String) -> String {
        return label.replacingOccurrences(of: "_", with: " ").capitalized
    }
}
