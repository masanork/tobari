const b64 = "EQF4EghGbyEhQDU3exMSJS8lOSVOJS0hISVeJTUlTiVqFAAVECUvJTkhISEhJV4lNSUxJXMWBzM1MjAzMDEXHkVsNX5FVEAkRURDKzZoQUQ7VUMrIzIhXSM3IV0jNxgHNTA1MDIwNhkFNzMwMDQaBE0lTkkbBzUxMDA0MDEcMj1gQ2Y3PyRHMT9FPiRHJC0kaz1gQ2Y3PzxWJE89YENmNz88ViFKIzUjdCFLJEs4QiRrHSY9YENmNz88ViFKIzUjdCFLJEhJYURMPFYkTyNBI1Q8ViRLOEIkax4AHwAgEEVsNX5FVDh4MEIwUTB3MnEhDDMwMDcwNjA1MDU0MCIHNTAwMDAwMCMHNDE5MDYxOCQHNTAwMDAwMCUHNTAwMDAwMCYHNTAwMDAwMCcHNTAwMDAwMCgHNTAwMDAwMCkHNTAwMDAwMCoHNTAwMDAwMCsHNTAwMDAwMCwHNTAwMDAwMC0HNTAwMDAwMC4HNTAwMDAwMC8HNTAwMDAwMDAHNTAwMDAwMDEHNTAwMDAwMDIHNTAwMDAwMDMHNDE5MDYxOP___________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________________w";
const buf = Buffer.from(b64, 'base64');
console.log("Hex:", buf.toString('hex').substring(0, 100));

function parseTLV(data, offset = 0) {
    if (offset >= data.length) return [];
    const tlvs = [];
    while (offset < data.length) {
        let tag = data[offset++];
        if (tag === 0 || tag === 0xFF) {
            // Padding
            continue;
        }
        
        let length = data[offset++];
        if (length === 0x81) {
            length = data[offset++];
        } else if (length === 0x82) {
            length = (data[offset++] << 8) | data[offset++];
        }
        
        const value = data.slice(offset, offset + length);
        console.log(`Tag: ${tag.toString(16).toUpperCase()}, Len: ${length}, Val: ${value.toString('hex').substring(0, 20)}...`);
        
        tlvs.push({ tag, length, value });
        offset += length;
    }
    return tlvs;
}

parseTLV(buf);
