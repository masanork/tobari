import Foundation

class CardReadHandler: CommandHandler {
    func handle(request: UnifiedRequest) async -> UnifiedResponse {
        do {
            let params = try decodeParams(ReadCardParams.self, from: request.params)

            switch params.cardType {
            case .jpki:
                return await readJPKI(params: params, command: request.command)
            case .passport:
                return await readPassport(params: params, command: request.command)
            case .driversLicense:
                return await readDriversLicense(params: params, command: request.command)
            case .residenceCard:
                return await readResidenceCard(command: request.command)
            }
        } catch {
            return UnifiedResponse.error(
                command: request.command,
                type: .invalidRequest,
                message: "Invalid parameters: \(error.localizedDescription)"
            )
        }
    }

    private func readJPKI(params: ReadCardParams, command: String) async -> UnifiedResponse {
        var pin = params.pin
        if pin == nil || pin?.isEmpty == true {
            pin = await MainActor.run {
                SecurityUtils.promptForPIN(
                    title: "マイナンバーカード 暗証番号",
                    message: "利用者証明用または券面事項入力補助用の4桁の数字を入力してください。"
                )
            }
        }

        guard let finalPin = pin, !finalPin.isEmpty else {
            return UnifiedResponse.error(
                command: command,
                type: .invalidRequest,
                message: "PIN is required for JPKI card reading"
            )
        }

        do {
            let manager = SmartCardManager.shared
            manager.beginOperation()
            defer { manager.endOperation() }
            try await manager.establishSession()
            let jpki = JPKIController(manager: manager)
            let info = try await jpki.readAttributes(pin: finalPin)

            var result: [String: Any] = [
                "name": info.name,
                "address": info.address,
                "birthDate": info.birthDate,
                "gender": info.gender
            ]

            if params.includeCertificates == true || params.includeCertificates == nil {
                result["authCert"] = info.authCert ?? ""
                result["signCert"] = info.signCert ?? ""
            }

            if params.includeMyNumber == true {
                let myNumber = try await jpki.readMyNumber(pin: finalPin)
                result["myNumber"] = myNumber
            }

            if params.includeFacePhoto == true {
                let myNumber: String
                if let mn = result["myNumber"] as? String {
                    myNumber = mn
                } else {
                    myNumber = try await jpki.readMyNumber(pin: finalPin)
                }
                let photoData = try await jpki.readFacePhoto(myNumber: myNumber)
                result["facePhoto"] = photoData.base64EncodedString()
            }

            return UnifiedResponse.success(
                command: command,
                type: .cardData,
                format: .json,
                data: result,
                metadata: [
                    "cardType": "jpki",
                    "includedFields": [
                        "basicInfo": true,
                        "myNumber": params.includeMyNumber == true,
                        "facePhoto": params.includeFacePhoto == true,
                        "certificates": params.includeCertificates != false
                    ]
                ]
            )
        } catch {
            return handleSignerError(error, command: command)
        }
    }

    private func readPassport(params: ReadCardParams, command: String) async -> UnifiedResponse {
        do {
            let manager = SmartCardManager.shared
            manager.beginOperation()
            defer { manager.endOperation() }
            try await manager.establishSession()
            let controller = PassportController(manager: manager)
            try await controller.selectPassportAP()

            if let can = params.can {
                try await controller.performPACE(password: can, isCan: true)
            } else if let mrz = params.mrz {
                var paceFailed = false
                if params.usePace != false {
                    do {
                        try await controller.performPACE(password: mrz, isCan: false)
                    } catch {
                        paceFailed = true
                    }
                }
                if params.usePace == false || (params.usePace == nil && paceFailed) || (params.usePace == true && paceFailed) {
                    if paceFailed { try await controller.selectPassportAP() }
                    try await controller.performBAC(mrz: mrz)
                }
            } else {
                return UnifiedResponse.error(command: command, type: .invalidRequest, message: "MRZ or CAN is required")
            }

            let info = try await controller.readFullPassportInfo()
            let encoder = JSONEncoder()
            let data = try encoder.encode(info)
            let dictionary = try JSONSerialization.jsonObject(with: data) as! [String: Any]

            return UnifiedResponse.success(
                command: command,
                type: .cardData,
                format: .json,
                data: dictionary,
                metadata: ["cardType": "passport", "protocolUsed": info.protocolUsed]
            )
        } catch {
            return handleSignerError(error, command: command)
        }
    }

    private func readDriversLicense(params: ReadCardParams, command: String) async -> UnifiedResponse {
        var pin1 = params.pin1
        if pin1 == nil || pin1?.isEmpty == true {
            pin1 = await MainActor.run {
                SecurityUtils.promptForPIN(title: "運転免許証 暗証番号1", message: "暗証番号1（4桁の数字）を入力してください。")
            }
        }
        guard let finalPin1 = pin1, !finalPin1.isEmpty else {
            return UnifiedResponse.error(command: command, type: .invalidRequest, message: "PIN1 is required")
        }

        var pin2 = params.pin2
        if pin2 == nil || pin2?.isEmpty == true {
            pin2 = await MainActor.run {
                SecurityUtils.promptForPIN(title: "運転免許証 暗証番号2", message: "写真や本籍地を読み取る場合は、暗証番号2（4桁の数字）を入力してください。省略する場合はそのままOKを押してください。")
            }
        }

        do {
            let manager = SmartCardManager.shared
            manager.beginOperation()
            defer { manager.endOperation() }
            let controller = DriversLicenseController(manager: manager)
            let info = try await controller.readData(pin1: finalPin1, pin2: pin2)
            let data = try JSONSerialization.jsonObject(with: try JSONEncoder().encode(info)) as! [String: Any]

            return UnifiedResponse.success(command: command, type: .cardData, format: .json, data: data, metadata: ["cardType": "drivers_license"])
        } catch {
            return handleSignerError(error, command: command)
        }
    }

    private func readResidenceCard(command: String) async -> UnifiedResponse {
        do {
            let manager = SmartCardManager.shared
            manager.beginOperation()
            defer { manager.endOperation() }
            let controller = ResidenceCardController(manager: manager)
            let info = try await controller.readDF2Info()
            let data = try JSONSerialization.jsonObject(with: try JSONEncoder().encode(info)) as! [String: Any]

            return UnifiedResponse.success(command: command, type: .cardData, format: .json, data: data, metadata: ["cardType": "residence_card"])
        } catch {
            return handleSignerError(error, command: command)
        }
    }
}
