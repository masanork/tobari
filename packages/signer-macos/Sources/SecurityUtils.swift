import Foundation
import AppKit
import LocalAuthentication

class SecurityUtils {
    /// Shows a native macOS dialog to prompt for a PIN
    static func promptForPIN(title: String, message: String) -> String? {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        
        let inputTextField = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 200, height: 24))
        alert.accessoryView = inputTextField
        
        // Force the alert to the front
        NSApp.activate(ignoringOtherApps: true)
        
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            return inputTextField.stringValue
        }
        return nil
    }
    
    /// Requests Touch ID / Face ID authentication
    static func authenticateUser(reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        
        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
            do {
                return try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
            } catch {
                return false
            }
        }
        return false
    }
}
