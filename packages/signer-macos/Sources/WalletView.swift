import SwiftUI

struct WalletView: View {
    @EnvironmentObject var state: AppState
    @State private var credentials: [WalletCredential] = []
    @State private var selectedCredential: WalletCredential?
    
    var body: some View {
        VStack {
            if credentials.isEmpty {
                VStack(spacing: 20) {
                    Image(systemName: "wallet.pass")
                        .font(.system(size: 60))
                        .foregroundColor(.secondary)
                    Text("Your Wallet is empty")
                        .font(.headline)
                    Text("Scan a card to add it to your digital identities.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(credentials) { cred in
                            CredentialRow(credential: cred)
                                .onTapGesture {
                                    selectedCredential = cred
                                }
                        }
                    }
                    .padding()
                }
            }
            
            Button(action: refresh) {
                Label("Refresh Wallet", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.plain)
            .padding(.bottom)
            .foregroundColor(.blue)
        }
        .onAppear(perform: refresh)
        .sheet(item: $selectedCredential) { cred in
            if let data = try? Data(contentsOf: URL(fileURLWithPath: cred.path)),
               let mdoc = try? CoseParser.parseMdoc(data: data) {
                CredentialDetailView(mdoc: mdoc, filename: cred.name)
            } else {
                VStack {
                    Text("Failed to load document")
                    Button("Close") { selectedCredential = nil }
                }
                .padding()
                .frame(width: 300, height: 200)
            }
        }
    }
    
    func refresh() {
        StorageManager.shared.ensureDirectoryStructure()
        credentials = StorageManager.shared.listCredentials()
    }
}

struct CredentialRow: View {
    let credential: WalletCredential
    
    var icon: String {
        if credential.docType.contains("passport") { return "passport" }
        if credential.docType.contains("license") { return "person.badge.shield.check" }
        if credential.docType.contains("resident") { return "house.fill" }
        return "doc.plaintext.fill"
    }
    
    var gradient: LinearGradient {
        if credential.docType.contains("passport") {
            return LinearGradient(colors: [Color(red: 0.1, green: 0.2, blue: 0.4), Color(red: 0.2, green: 0.4, blue: 0.6)], startPoint: .topLeading, endPoint: .bottomTrailing)
        } else if credential.docType.contains("license") {
            return LinearGradient(colors: [Color.blue.opacity(0.8), Color.cyan.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing)
        } else if credential.docType.contains("resident") {
            return LinearGradient(colors: [Color.green.opacity(0.7), Color.teal.opacity(0.5)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        return LinearGradient(colors: [Color.gray.opacity(0.6), Color.gray.opacity(0.4)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
    
    var body: some View {
        HStack(spacing: 15) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(gradient)
                    .frame(width: 54, height: 54)
                    .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 2)
                
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundColor(.white)
            }
            
            VStack(alignment: .leading, spacing: 4) {
                Text(formatName(credential.name))
                    .font(.system(.headline, design: .rounded))
                Text(formatDocType(credential.docType))
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
            
            Spacer()
            
            if let date = credential.createdAt {
                Text(date, style: .date)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary.opacity(0.7))
            }
            
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.secondary.opacity(0.5))
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(NSColor.controlBackgroundColor))
                .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.primary.opacity(0.05), lineWidth: 1)
        )
    }

    private func formatName(_ name: String) -> String {
        return name.replacingOccurrences(of: ".cose", with: "").replacingOccurrences(of: "_", with: " ").capitalized
    }

    private func formatDocType(_ docType: String) -> String {
        if docType.contains("mDL") { return "Driver's License" }
        if docType.contains("passport") { return "ICAO 9303 Passport" }
        if docType.contains("resident") { return "Resident Record" }
        return docType
    }
}
