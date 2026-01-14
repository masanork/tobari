/**
 * 郵便番号ルックアップエンジン
 * 
 * 圧縮された郵便番号データを展開し、高速な検索インターフェースを提供
 */

export interface PostalRecord {
    zip: string;
    pref: string;
    city: string;
    town: string;
}

interface OptimizedGroup {
    p: number;  // 都道府県ID (1-47)
    t: [string, string, string][]; // [下4桁, 市区町村名, 町字名]
}

const PREFECTURES = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
    '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
    '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
    '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'
];

export class PostalLookup {
    private data: Record<string, OptimizedGroup> = {};
    private initialized = false;
    private instanceId = Math.random().toString(36).substring(7);

    constructor() {
        console.log('[PostalLookup] New instance created:', this.instanceId);
    }

    /**
     * 埋め込みBase64データからロード
     */
    async loadFromBase64(base64Data: string): Promise<void> {
        try {
            // First decode Base64 to binary
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Try to detect if it's Gzipped (Magic number: 1f 8b)
            let jsonString: string;
            if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
                // Gzip Decompression
                if (typeof DecompressionStream !== 'undefined') {
                    const ds = new DecompressionStream('gzip');
                    const stream = new Blob([bytes]).stream().pipeThrough(ds);
                    jsonString = await new Response(stream).text();
                } else {
                    // Fallback for older browsers? Or just fail appropriately.
                    // Ideally we should use pako or fflate if we need broad support,
                    // but for modern Web/A context, DecompressionStream is fine.
                    throw new Error('DecompressionStream not supported');
                }
            } else {
                // Plain JSON (fallback for uncompressed data)
                jsonString = new TextDecoder().decode(bytes);
            }

            this.data = JSON.parse(jsonString);
            this.initialized = true;
            console.log('📮 Postal lookup initialized:', Object.keys(this.data).length, 'prefixes', '[Instance:', this.instanceId + ']');
        } catch (error) {
            console.error('Failed to load postal data:', error);
            // Don't throw, just log, so runtime doesn't crash completely
        }
    }

    /**
     * マニフェスト(L1)からロード
     * DOM埋め込み(Pack) -> 外部取得(Prune) の順で試行
     */
    async loadFromManifest(): Promise<boolean> {
        const manifest = (window as any).__WEBA_MANIFEST;
        if (!manifest || !manifest.blobs) return false;
        
        const postalEntry = manifest.blobs.find((b: any) => b.id === 'jp-postal');
        if (!postalEntry || !postalEntry.urls || postalEntry.urls.length === 0) return false;

        for (const url of postalEntry.urls) {
            try {
                if (url.startsWith('#')) {
                    // 1. Embedded Data (DOM ID)
                    const el = document.querySelector(url);
                    if (el && el.textContent) {
                        console.log('📮 Loading postal data from embedded source:', url);
                        await this.loadFromBase64(el.textContent.trim());
                        // loadFromBase64 sets initialized=true
                        if (this.initialized) {
                             (this as any)._activeDigest = postalEntry.digest;
                             return true;
                        }
                    }
                } else {
                    // 2. External Data (Network)
                    console.log('📮 Loading postal data from network:', url);
                    const response = await fetch(url);
                    if (!response.ok) continue; // Try next URL

                    const blob = await response.blob();
                    let jsonString: string;

                    const header = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
                    if (header[0] === 0x1f && header[1] === 0x8b) {
                        if (typeof DecompressionStream !== 'undefined') {
                            const ds = new DecompressionStream('gzip');
                            const stream = blob.stream().pipeThrough(ds);
                            jsonString = await new Response(stream).text();
                        } else {
                            throw new Error('DecompressionStream not supported');
                        }
                    } else {
                        jsonString = await blob.text();
                    }

                    this.data = JSON.parse(jsonString);
                    this.initialized = true;
                    (this as any)._activeDigest = postalEntry.digest;
                    console.log('📮 Postal lookup initialized via Network:', Object.keys(this.data).length, 'prefixes');
                    return true;
                }
            } catch (e) {
                console.warn(`Failed to load postal from ${url}:`, e);
                // Continue to next URL
            }
        }
        
        return false;
    }

    /**
     * 埋め込みデータから自動初期化
     */
    async autoInit(): Promise<void> {
        // Already initialized, skip
        if (this.initialized) {
            console.log('📮 Postal lookup already initialized, skipping');
            return;
        }

        // Try Manifest first (Web/A Architecture)
        if (await this.loadFromManifest()) {
            return;
        }

        // HTML内の<script id="weba-postal-data">を探す (Fallback/Legacy)
        const scriptEl = document.getElementById('weba-postal-data');
        if (scriptEl && scriptEl.textContent) {
            await this.loadFromBase64(scriptEl.textContent.trim());
        } else {
            console.warn('No postal data found in document');
        }
    }

    /**
     * アクティブなデータのDigestを取得（L2署名用）
     */
    getActiveDigest(): string | null {
        return (this as any)._activeDigest || null;
    }


    /**
     * 郵便番号から完全一致検索
     */
    lookup(zip: string): PostalRecord | null {
        if (!this.initialized) return null;

        const normalized = zip.replace(/[^0-9]/g, '');
        if (normalized.length !== 7) return null;

        const prefix = normalized.substring(0, 3);
        const suffix = normalized.substring(3);

        const group = this.data[prefix];
        if (!group) return null;

        const entry = group.t.find(([s]) => s === suffix);
        if (!entry) return null;

        return {
            zip: normalized,
            pref: PREFECTURES[group.p - 1],
            city: entry[1],
            town: entry[2]
        };
    }

    /**
     * 前方一致検索（サジェスト用）
     */
    suggest(partialZip: string, maxResults = 50): PostalRecord[] {
        if (!this.initialized) return [];

        const normalized = partialZip.replace(/[^0-9]/g, '');
        if (normalized.length < 3) return [];

        const prefix = normalized.substring(0, 3);
        const suffix = normalized.substring(3);
        const results: PostalRecord[] = [];

        // 完全一致プレフィックス
        const group = this.data[prefix];
        if (group) {
            for (const [s, city, town] of group.t) {
                if (!suffix || s.startsWith(suffix)) {
                    results.push({
                        zip: prefix + s,
                        pref: PREFECTURES[group.p - 1],
                        city,
                        town
                    });
                    if (results.length >= maxResults) return results;
                }
            }
        }

        return results;
    }

    /**
     * 3桁入力時の候補一覧取得
     */
    getPrefixCandidates(prefix: string): PostalRecord[] {
        if (!this.initialized) return [];

        const normalized = prefix.replace(/[^0-9]/g, '');
        if (normalized.length !== 3) return [];

        const group = this.data[normalized];
        if (!group) return [];

        return group.t.map(([suffix, city, town]) => ({
            zip: normalized + suffix,
            pref: PREFECTURES[group.p - 1],
            city,
            town
        }));
    }

    /**
     * 住所文字列から検索（逆引きサジェスト）
     */
    suggestByAddress(query: string, maxResults = 30): PostalRecord[] {
        if (!this.initialized || query.length < 2) return [];

        const results: PostalRecord[] = [];
        const normQuery = query.trim();

        for (const prefix in this.data) {
            if (!Object.prototype.hasOwnProperty.call(this.data, prefix)) continue;
            const group = this.data[prefix];
            if (!group) continue;
            const pref = PREFECTURES[group.p - 1] || '';
            for (const [suffix, city, town] of group.t) {
                // 都道府県 + 市区町村 + 町名を結合して検索
                const fullAddr = pref + city + town;
                if (fullAddr.includes(normQuery)) {
                    results.push({
                        zip: prefix + suffix,
                        pref,
                        city,
                        town
                    });
                    if (results.length >= maxResults) return results;
                }
            }
        }
        return results;
    }

    /**
     * 初期化済みかどうか
     */
    isReady(): boolean {
        return this.initialized;
    }
}

/**
 * グローバルインスタンス（シングルトン）
 */
export const postalLookup = new PostalLookup();

if (typeof window !== 'undefined') {
    // Only set window.postalLookup if it doesn't exist yet
    // This prevents multiple bundle loads from overwriting an initialized instance
    if (!(window as any).postalLookup) {
        console.log('[PostalLookup] Registering instance to window:', postalLookup['instanceId']);
        (window as any).postalLookup = postalLookup;
    } else {
        console.log('[PostalLookup] window.postalLookup already exists, skipping registration. Existing instance:', (window as any).postalLookup['instanceId'], 'New instance:', postalLookup['instanceId']);
    }
}
