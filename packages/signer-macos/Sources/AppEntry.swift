import SwiftUI
import Foundation

// Main entry point - handle CLI mode before SwiftUI initialization
@main
struct AppMain {
    static func main() async {
        let args = ProcessInfo.processInfo.arguments

        if args.count > 1 {
            // CLI Mode: Run handler and exit
            // Check if this is a unified interface request
            if let requestIndex = args.firstIndex(of: "--request"),
               requestIndex + 1 < args.count {
                let requestJSON = args[requestIndex + 1]

                // Try to parse as UnifiedRequest
                if let data = requestJSON.data(using: .utf8) {
                    do {
                        let request = try JSONDecoder().decode(UnifiedRequest.self, from: data)
                        // Use unified handler
                        let handler = UnifiedCLIHandler()
                        await handler.handle(request: request)
                        exit(0)
                    } catch {
                        fputs("Debug: UnifiedRequest decode failed: \(error)\n", stderr)
                    }
                }
            }

            // Fall back to legacy CLI handler
            let handler = CLIHandler()
            await handler.run()
            exit(0)
        } else {
            // GUI Mode: Start SwiftUI app
            SignerApp.main()
        }
    }
}

struct SignerApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            MainView()
                .environmentObject(appState)
                .frame(minWidth: 600, minHeight: 450)
        }
    }
}