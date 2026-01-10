use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn test_cli_id_demo_jpki() {
    let mut cmd = Command::cargo_bin("civ").unwrap();
    cmd.arg("--demo")
        .arg("id")
        .arg("--type=jpki")
        .arg("--pin=1234")
        .assert()
        .success()
        .stdout(predicate::str::contains("Card Type: MyNumberCard"))
        .stdout(predicate::str::contains("Name:      Taro"))
        .stdout(predicate::str::contains("DOB:       1990-01-01"));
}

#[test]
fn test_cli_id_demo_passport() {
    let mut cmd = Command::cargo_bin("civ").unwrap();
    cmd.arg("--demo")
        .arg("id")
        .arg("--type=passport")
        .arg("--mrz=123456")
        .assert()
        .success()
        .stdout(predicate::str::contains("Card Type: Passport"))
        .stdout(predicate::str::contains("Verified:  NO")); // PA not verified by default id command unless --verify
}

#[test]
fn test_cli_id_demo_passport_verify() {
    let mut cmd = Command::cargo_bin("civ").unwrap();
    cmd.arg("--demo")
        .arg("id")
        .arg("--type=passport")
        .arg("--mrz=123456")
        .arg("--verify")
        .assert()
        .success()
        .stdout(predicate::str::contains("Card Type: Passport"))
        .stdout(predicate::str::contains("Verified:  YES"));
}

#[test]
fn test_cli_id_demo_mynamenkyo() {
    let mut cmd = Command::cargo_bin("civ").unwrap();
    cmd.arg("--demo")
        .arg("id")
        .arg("--type=mynamenkyo")
        .arg("--pin=1234")
        .assert()
        .success()
        .stdout(predicate::str::contains("Card Type: MyNaMenkyo"))
        .stdout(predicate::str::contains("ID Number: 123456789012"));
}

#[test]
fn test_cli_jpki_cert() {
    let mut cmd = Command::cargo_bin("civ").unwrap();
    cmd.arg("--demo")
        .arg("jpki")
        .arg("cert")
        .arg("--type=auth")
        .assert()
        .success()
        .stdout(predicate::str::contains("Hex: 30820100")); // Mock cert data
}
