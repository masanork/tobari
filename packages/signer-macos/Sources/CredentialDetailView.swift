import SwiftUI

struct CredentialDetailView: View {
    let mdoc: MdocDocument
    let filename: String
    @Environment(\.dismiss) var dismiss

    var headerGradient: LinearGradient {
        if mdoc.docType.contains("passport") {
            return LinearGradient(colors: [Color(red: 0.1, green: 0.2, blue: 0.4), Color(red: 0.2, green: 0.4, blue: 0.6)], startPoint: .topLeading, endPoint: .bottomTrailing)
        } else if mdoc.docType.contains("license") {
            return LinearGradient(colors: [Color.blue.opacity(0.8), Color.cyan.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing)
        } else if mdoc.docType.contains("resident") {
            return LinearGradient(colors: [Color.green.opacity(0.7), Color.teal.opacity(0.5)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        return LinearGradient(colors: [Color.gray.opacity(0.6), Color.gray.opacity(0.4)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Card-style Header with Gradient
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(formatDocType(mdoc.docType))
                        .font(.system(.title2, design: .rounded))
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                    Text(filename)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundColor(.white.opacity(0.8))
                }
                Spacer()
                Button(action: { dismiss() }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundColor(.white.opacity(0.7))
                }
                .buttonStyle(.plain)
            }
            .padding(24)
            .background(headerGradient)

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
                .frame(width: 140, alignment: .leading)
            
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