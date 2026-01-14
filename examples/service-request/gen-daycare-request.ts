import { generateSignedTobari } from '../../packages/codec/src/tobari-gen';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

async function main() {
    console.log("Generating Daycare Enrollment Request document...");

    const schemaStr = await fs.readFile(path.join(__dirname, 'daycare-enrollment.yaml'), 'utf-8');
    // Using the same data as child-allowance but customized for daycare
    const data = {
        title: "保育園入園申請（教育・保育給付認定）",
        description: "保育園の入園申請および保育の必要性の認定を申請します。",
        eligibility: "当区に住民登録があり、就労等の理由により保育を必要とする世帯。",
        submission_uri: "https://city.example.jp/api/daycare/submit",
        presentation_definition: {
            id: "daycare_request_pd",
            input_descriptors: [
                {
                    id: "resident_record",
                    name: "住民票の写し（世帯全員）",
                    purpose: "家族構成およびお子様の年齢を確認し、選考指数を算定するために使用します。",
                    format: { mso_mdoc: { alg: ["ES256", "ES384"] } },
                    constraints: {
                        fields: [
                            { path: ["$['io.github.masanork.tobari.juminhyo.v1']['世帯員']"] },
                            { path: ["$['io.github.masanork.tobari.juminhyo.v1']['世帯住所']"] }
                        ]
                    }
                },
                {
                    id: "work_certificate",
                    name: "就労証明書",
                    purpose: "保護者の就労状況を確認し、保育の必要性を判定するために使用します。",
                    format: { mso_mdoc: { alg: ["ES256", "ES384"] } },
                    constraints: {
                        fields: [
                            { path: ["$['io.github.masanork.tobari.work-cert.v1']['本人氏名']"] },
                            { path: ["$['io.github.masanork.tobari.work-cert.v1']['雇用形態']"] },
                            { path: ["$['io.github.masanork.tobari.work-cert.v1']['就労時間合計']"] },
                            { path: ["$['io.github.masanork.tobari.work-cert.v1']['事業所名']"] }
                        ]
                    }
                }
            ]
        }
    };

    // Generate Issuer Key
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-384" },
        true,
        ["sign", "verify"]
    );

    const coseBytes = await generateSignedTobari(schemaStr, data, keyPair.privateKey, {
        kid: "iss-daycare-request-p384"
    });
    
    const outputCose = path.join(__dirname, 'daycare-enrollment.cose');
    await fs.writeFile(outputCose, coseBytes);
    console.log(`Generated COSE: ${outputCose}`);

    // Bundle HTML viewer
    const bundleScript = path.resolve(__dirname, '../../packages/codec/src/bundle-viewer.ts');
    const proc = Bun.spawn(["bun", "run", bundleScript, outputCose], { stdout: "inherit" });
    await proc.exited;
}

main().catch(console.error);
