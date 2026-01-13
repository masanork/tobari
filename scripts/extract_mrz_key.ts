const args = process.argv.slice(2);

if (args.length < 2) {
    console.error("Usage: bun run scripts/extract_mrz_key.ts <line1> <line2>");
    console.error("Example: bun run scripts/extract_mrz_key.ts 'P<JPNKYOKUYA<<TARO<<<<<<<<<<<<<<<<<<<<<<<<' 'TR77777770JPN8501019M2512311<<<<<<<<<<<<<<06'");
    process.exit(1);
}

const line2 = args[1];

// MRZ TD3 Line 2 Structure
// 0-9   : Document Number (9 chars) + Check Digit (1 char)
// 10-12 : Nationality (3 chars)
// 13-19 : Date of Birth (6 chars) + Check Digit (1 char)
// 20    : Sex (1 char)
// 21-27 : Expiry Date (6 chars) + Check Digit (1 char)

if (line2.length < 28) {
    console.error("Error: Line 2 is too short.");
    process.exit(1);
}

const docNo = line2.substring(0, 10);
const dob = line2.substring(13, 20);
const expiry = line2.substring(21, 28);

const key = docNo + dob + expiry;

console.log("\n--- MRZ Key for civ command ---");
console.log(key);
console.log("-------------------------------\n");
console.log(`Run: cargo run -p civ --bin civ -- id --type passport --mrz "${key}"`);
