import SwiftUI

struct WalletView: View {
    @EnvironmentObject var state: AppState
    @State private var credentials: [WalletCredential] = []
    
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
        if credential.docType.contains("resident") { return "house" }
        return "doc.plaintext"
    }
    
    var body: some View {
        HStack(spacing: 15) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.blue.opacity(0.1))
                    .frame(width: 48, height: 48)
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundColor(.blue)
            }
            
            VStack(alignment: .leading, spacing: 4) {
                Text(credential.name)
                    .font(.headline)
                Text(credential.docType)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
            
            Spacer()
            
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.primary.opacity(0.1), lineWidth: 1)
        )
    }
}
