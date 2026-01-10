use crate::apdu::ApduCommand;
use crate::crypto::bac::BacSession;
use crate::crypto::sm::AesSecureMessaging;

pub enum MockSecureSession {
    Bac(BacSession),
    Pace(AesSecureMessaging),
}

impl MockSecureSession {
    pub fn is_null_session(&self) -> bool {
        match self {
            MockSecureSession::Bac(s) => s.is_null_session(),
            MockSecureSession::Pace(s) => s.is_null_session(),
        }
    }

    pub fn wrap_response(&mut self, res_data: &[u8], sw1: u8, sw2: u8) -> anyhow::Result<Vec<u8>> {
        match self {
            MockSecureSession::Bac(s) => s.wrap_response_from_card(res_data, sw1, sw2),
            MockSecureSession::Pace(s) => s.wrap_response_from_card(res_data, sw1, sw2).map_err(|e| anyhow::anyhow!(e.to_string())),
        }
    }

    pub fn unwrap_command(&mut self, cmd: &ApduCommand) -> anyhow::Result<ApduCommand> {
        match self {
            MockSecureSession::Bac(s) => {
                if s.is_null_session() {
                    return Ok(ApduCommand {
                        cla: cmd.cla & !0x0C,
                        ins: cmd.ins,
                        p1: cmd.p1,
                        p2: cmd.p2,
                        data: cmd.data.clone(),
                        le: cmd.le,
                    });
                }
                s.unwrap_command(cmd)
            },
            MockSecureSession::Pace(s) => s.unwrap_command_from_reader(cmd).map_err(|e| anyhow::anyhow!(e.to_string())),
        }
    }
}

pub trait MockBackend: Send {
    fn handle_apdu(&mut self, cmd: &ApduCommand, aid: &[u8]) -> (Vec<u8>, u16);
    fn get_secure_session(&mut self) -> Option<MockSecureSession> { None }
}

pub fn der_wrap(tag: u8, data: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    let len = data.len();
    if len <= 127 { out.push(len as u8); }
    else if len <= 255 { out.push(0x81); out.push(len as u8); }
    else { out.push(0x82); out.push((len >> 8) as u8); out.push((len & 0xFF) as u8); }
    out.extend_from_slice(data);
    out
}

pub fn build_tlv(tag: u8, value: &[u8]) -> Vec<u8> {
    let mut out = vec![0x7C]; 
    let mut inner = vec![tag];
    if value.len() <= 127 { inner.push(value.len() as u8); }
    else { inner.push(0x81); inner.push(value.len() as u8); }
    inner.extend_from_slice(value);
    out.push(inner.len() as u8);
    out.extend_from_slice(&inner);
    out
}

pub fn extract_tlv_value(data: &[u8], target_tag: u8) -> Option<Vec<u8>> {
    if data.len() < 2 || data[0] != 0x7C { return None; }
    let mut i = 2;
    while i < data.len() {
        let tag = data[i];
        let len = data[i+1] as usize;
        if tag == target_tag { return Some(data[i+2..i+2+len].to_vec()); }
        i += 2 + len;
    }
    None
}
