import SwiftUI
import AVFoundation
import Vision

struct ScannerView: View {
    @Binding var isPresented: Bool
    @Binding var mrzResult: String
    @StateObject private var scanner = ScannerViewModel()
    
    var body: some View {
        VStack {
            HStack {
                Text("Scan Passport MRZ")
                    .font(.headline)
                Spacer()
                Button("Close") { isPresented = false }
            }
            .padding()
            
            ZStack {
                CameraPreview(session: scanner.session)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                
                // Overlay scanning area guide
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.white.opacity(0.5), lineWidth: 2)
                    .frame(width: 350, height: 100)
                    .overlay(
                        Text("Align MRZ here")
                            .font(.caption)
                            .foregroundColor(.white)
                            .padding(.top, 120)
                    )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            
            if scanner.isScanning {
                ProgressView("Analyzing...")
                    .padding()
            }
        }
        .onAppear { scanner.start() }
        .onDisappear { scanner.stop() }
        .onChange(of: scanner.detectedMRZ) { newValue in
            if let result = newValue {
                mrzResult = result
                isPresented = false
            }
        }
    }
}

class ScannerViewModel: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    @Published var session = AVCaptureSession()
    @Published var detectedMRZ: String? = nil
    @Published var isScanning = true
    
    private var frameCounter = 0
    
    func start() {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else { return }
        do {
            let input = try AVCaptureDeviceInput(device: device)
            if session.canAddInput(input) { session.addInput(input) }
            
            let output = AVCaptureVideoDataOutput()
            output.setSampleBufferDelegate(self, queue: DispatchQueue(label: "videoQueue"))
            if session.canAddOutput(output) { session.addOutput(output) }
            
            Task { session.startRunning() }
        } catch {
            print("Camera Error: \(error)")
        }
    }
    
    func stop() {
        session.stopRunning()
    }
    
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        frameCounter += 1
        if frameCounter % 15 != 0 { return } // Process every 15th frame
        
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        
        let request = VNRecognizeTextRequest { request, error in
            guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
            let strings = observations.compactMap { $0.topCandidates(1).first?.string }
            
            let cleaned = strings.map { $0.replacingOccurrences(of: " ", with: "").uppercased() }
            
            var mrz: String? = nil
            
            // Try TD3
            let td3Candidates = cleaned.filter { $0.count == 44 }
            if td3Candidates.count >= 2 {
                let lines = Array(td3Candidates.suffix(2))
                if MRZParser.parse(lines: lines) != nil {
                    mrz = lines.joined(separator: "\n")
                }
            }
            
            // Try TD1
            if mrz == nil {
                let td1Candidates = cleaned.filter { $0.count == 30 }
                if td1Candidates.count >= 3 {
                    let lines = Array(td1Candidates.suffix(3))
                    if MRZParser.parse(lines: lines) != nil {
                        mrz = lines.joined(separator: "\n")
                    }
                }
            }
            
            if let detected = mrz {
                DispatchQueue.main.async {
                    self.detectedMRZ = detected
                }
            }
        }
        request.recognitionLevel = .accurate
        
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        try? handler.perform([request])
    }
}

struct CameraPreview: NSViewRepresentable {
    let session: AVCaptureSession
    
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.wantsLayer = true
        view.layer = layer
        return view
    }
    
    func updateNSView(_ nsView: NSView, context: Context) {
        nsView.layer?.frame = nsView.bounds
    }
}
