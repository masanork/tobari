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
        .stdout(predicate::str::contains("Verified:  NO"));
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
fn test_cli_invalid_type() {
    let mut cmd = Command::cargo_bin("civ").unwrap();
    cmd.arg("--demo")
        .arg("id")
        .arg("--type=invalid")
        .assert()
        .failure();
}

#[test]

fn test_cli_passport_missing_mrz() {

    let mut cmd = Command::cargo_bin("civ").unwrap();

    cmd.arg("--demo")

        .arg("id")

        .arg("--type=passport")

        .assert()

        .failure();

}



#[test]

fn test_cli_jpki_missing_pin() {

    let mut cmd = Command::cargo_bin("civ").unwrap();

    cmd.arg("--demo")

        .arg("id")

        .arg("--type=jpki")

        .assert()

        .failure();

}



#[test]

fn test_cli_unknown_command() {

    let mut cmd = Command::cargo_bin("civ").unwrap();

    cmd.arg("unknown")

        .assert()

        .failure();

}
