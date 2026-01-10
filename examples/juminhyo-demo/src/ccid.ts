// Minimal CCID Implementation for WebUSB
// Based on USB Device Class: Smart Card (CCID) Specification, Rev 1.1

export class WebUSBCardReader {
  private device: USBDevice | null = null;
  private interfaceNumber: number = 0;
  private endpointIn: number = 0;
  private endpointOut: number = 0;
  private seq: number = 0;

  constructor() {}

  async connect(): Promise<void> {
    try {
      this.device = await navigator.usb.requestDevice({
        filters: [{ classCode: 0x0B }] // Smart Card Class
      });
    } catch (e) {
      throw new Error("No device selected");
    }

    if (!this.device) throw new Error("Device not found");

    await this.device.open();
    
    // Find CCID Interface
    // CCID Class: 0x0B
    const conf = this.device.configurations[0];
    const intf = conf.interfaces.find(i => 
      i.alternates[0].interfaceClass === 0x0B
    );

    if (!intf) {
      await this.device.close();
      throw new Error("No CCID interface found");
    }

    this.interfaceNumber = intf.interfaceNumber;
    await this.device.selectConfiguration(conf.configurationValue);
    await this.device.claimInterface(this.interfaceNumber);

    // Find Endpoints
    const alt = intf.alternates[0];
    const epIn = alt.endpoints.find(e => e.direction === "in");
    const epOut = alt.endpoints.find(e => e.direction === "out");

    if (!epIn || !epOut) {
      throw new Error("Endpoints not found");
    }

    this.endpointIn = epIn.endpointNumber;
    this.endpointOut = epOut.endpointNumber;

    // Power On (PC_to_RDR_IccPowerOn)
    await this.powerOn();
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      await this.device.close();
      this.device = null;
    }
  }

  // Required by Rust Wasm wrapper
  async transmit(apdu: Uint8Array): Promise<Uint8Array> {
    if (!this.device) throw new Error("Device not connected");

    // PC_to_RDR_XfrBlock
    const header = new Uint8Array(10);
    header[0] = 0x6F; // Message Type
    header[1] = apdu.length & 0xFF; // Length (LE)
    header[2] = (apdu.length >> 8) & 0xFF;
    header[3] = (apdu.length >> 16) & 0xFF;
    header[4] = (apdu.length >> 24) & 0xFF;
    header[5] = 0x00; // Slot
    header[6] = this.seq++; // Seq
    header[7] = 0x04; // Block Wait Time Extension (BWI) - Legacy?
    header[8] = 0x00; // Level Parameter
    header[9] = 0x00;

    const cmd = new Uint8Array(header.length + apdu.length);
    cmd.set(header);
    cmd.set(apdu, 10);

    await this.device.transferOut(this.endpointOut, cmd);

    // Read Response (RDR_to_PC_DataBlock)
    // First read header to know length
    // Actually, USB bulk transfer might return everything or partial.
    // For CCID, usually we read 64 bytes or max packet size first.
    
    // Simplification: Read expected header + some buffer
    const res = await this.device.transferIn(this.endpointIn, 1024); // Assuming < 1024 for now
    
    if (!res.data || res.data.byteLength < 10) {
      throw new Error("Invalid CCID response (too short)");
    }

    const resData = new Uint8Array(res.data.buffer);
    const msgType = resData[0];
    const len = resData[1] | (resData[2] << 8) | (resData[3] << 16) | (resData[4] << 24);
    
    // 0x80: RDR_to_PC_DataBlock
    if (msgType !== 0x80) {
      throw new Error(`CCID Error: Message Type ${msgType.toString(16)}`);
    }

    // Status is at offset 7
    // const status = resData[7];
    // if ((status & 0x01) !== 0) throw new Error("Card Failed");

    return resData.slice(10, 10 + len);
  }

  private async powerOn(): Promise<void> {
    if (!this.device) return;
    // PC_to_RDR_IccPowerOn
    const cmd = new Uint8Array(10);
    cmd[0] = 0x62;
    cmd[1] = 0x00; cmd[2] = 0x00; cmd[3] = 0x00; cmd[4] = 0x00;
    cmd[5] = 0x00; // Slot
    cmd[6] = this.seq++;
    cmd[7] = 0x00; // Power Select (00=Auto, 01=5V, 02=3V, 03=1.8V)
    cmd[8] = 0x00;
    cmd[9] = 0x00;

    await this.device.transferOut(this.endpointOut, cmd);
    const res = await this.device.transferIn(this.endpointIn, 1024);
    
    // RDR_to_PC_DataBlock with ATR
    // Just check header
    if (!res.data || res.data.byteLength < 10) throw new Error("PowerOn failed");
  }
}
