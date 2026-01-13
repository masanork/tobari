import * as fs from "fs";
import * as path from "path";

// Use a type-only import or any for X509Certificate to avoid browser build issues
type X509Certificate = any;

export class TrustStore {
    private certMap: Map<string, X509Certificate> = new Map();

    constructor(baseDir: string) {
        if (fs.existsSync(baseDir)) {
            // We'll perform scanning asynchronously or skip in browser
            try {
                this.scanDirectory(baseDir);
            } catch {
                // Ignore if fs is not available
            }
        }
    }

    private async scanDirectory(dir: string) {
        const { X509Certificate } = await import('node:crypto');
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                this.scanDirectory(fullPath);
            } else if (entry.name.endsWith(".der") || entry.name.endsWith(".cer")) {
                try {
                    const certBuffer = fs.readFileSync(fullPath);
                    const cert = new X509Certificate(certBuffer);
                    // Index by Subject for quick lookup
                    this.certMap.set(cert.subject, cert);
                } catch (e) {
                    // Skip malformed certs
                }
            }
        }
    }

    /**
     * Finds a parent certificate for a given certificate.
     */
    findIssuer(cert: X509Certificate): X509Certificate | undefined {
        return this.certMap.get(cert.issuer);
    }

    /**
     * Verifies a certificate chain up to a trusted root.
     */
    verifyChain(cert: X509Certificate): boolean {
        let current = cert;
        // Basic chain walk (limit to avoid cycles)
        for (let i = 0; i < 5; i++) {
            const issuer = this.findIssuer(current);
            if (!issuer) return false;
            
            try {
                if (!current.verify(issuer.publicKey)) return false;
                // If issuer is self-signed (root), we are done
                if (issuer.subject === issuer.issuer) return true;
                current = issuer;
            } catch {
                return false;
            }
        }
        return false;
    }
}
