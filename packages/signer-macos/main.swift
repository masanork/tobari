import Foundation

// Main Entry Point
let cli = CLIHandler()
// CLI runs in an async context
let semaphore = DispatchSemaphore(value: 0)

Task {
    await cli.run()
    semaphore.signal()
}

semaphore.wait()
