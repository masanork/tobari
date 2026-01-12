# Makefile for tobari-signer-macos
# Builds a Swift-based macOS application for smartcard operations

#==============================================================================
# Configuration
#==============================================================================

PROJECT_NAME = tobari-signer-macos
APP_NAME = Tobari Signer
SOURCES_DIR = Sources
TESTS_DIR = Tests
BIN_DIR = bin
ENTITLEMENTS = entitlements.plist
INFO_PLIST = Info.plist
APP_BUNDLE = $(BIN_DIR)/$(APP_NAME).app

#==============================================================================
# Build Tools
#==============================================================================

SWIFTC = swiftc
CODESIGN = codesign

#==============================================================================
# Source Files
#==============================================================================

ALL_SOURCES = $(wildcard $(SOURCES_DIR)/*.swift)
LOGIC_SOURCES = $(filter-out $(SOURCES_DIR)/AppEntry.swift $(SOURCES_DIR)/MainView.swift, $(ALL_SOURCES))
TEST_SOURCES = $(wildcard $(TESTS_DIR)/*Tests.swift)
MOCK_SOURCES = $(TESTS_DIR)/MockSmartCardManager.swift

#==============================================================================
# Build Output
#==============================================================================

OUTPUT_BINARY = $(BIN_DIR)/$(PROJECT_NAME)

#==============================================================================
# Compiler Flags
#==============================================================================

FRAMEWORKS = -framework Foundation \
             -framework CryptoKit \
             -framework Security \
             -framework AppKit \
             -framework AuthenticationServices \
             -framework LocalAuthentication \
             -framework CryptoTokenKit \
             -framework SwiftUI

SWIFT_FLAGS_DEBUG = -g
SWIFT_FLAGS_RELEASE = -O -whole-module-optimization

#==============================================================================
# Code Signing
#==============================================================================

SIGN_ADHOC = -s -
SIGN_WITH_ENTITLEMENTS = -s - --entitlements $(ENTITLEMENTS)

#==============================================================================
# Default Target
#==============================================================================

.DEFAULT_GOAL := help

#==============================================================================
# Build Targets
#==============================================================================

all: dev

dev: build
build: $(OUTPUT_BINARY)

$(OUTPUT_BINARY): $(ALL_SOURCES) | $(BIN_DIR)
	@echo "🔨 Building $(PROJECT_NAME) (development mode)..."
	@$(SWIFTC) -o $@ $(ALL_SOURCES) $(FRAMEWORKS) $(SWIFT_FLAGS_DEBUG)
	@$(CODESIGN) $(SIGN_ADHOC) $@
	@echo "✅ Development build complete: $@"

release: build-signed
build-signed: $(OUTPUT_BINARY)-signed

$(OUTPUT_BINARY)-signed: $(ALL_SOURCES) $(ENTITLEMENTS) | $(BIN_DIR)
	@echo "🔨 Building $(PROJECT_NAME) (release mode with entitlements)..."
	@$(SWIFTC) -o $(OUTPUT_BINARY) $(ALL_SOURCES) $(FRAMEWORKS) $(SWIFT_FLAGS_RELEASE)
	@$(CODESIGN) $(SIGN_WITH_ENTITLEMENTS) $(OUTPUT_BINARY)
	@echo "✅ Release build complete: $(OUTPUT_BINARY)"
	@echo "📝 Entitlements applied from $(ENTITLEMENTS)"
	@touch $@

#==============================================================================
# Test Targets
#==============================================================================

test:
	@echo "🧪 Running test suite..."
	@chmod +x $(BIN_DIR)/run_tests.sh
	@$(BIN_DIR)/run_tests.sh

#==============================================================================
# Run Targets
#==============================================================================

run: dev
	@echo "🚀 Running $(PROJECT_NAME)..."
	@$(OUTPUT_BINARY)

run-signed: release
	@echo "🚀 Running $(PROJECT_NAME) (with entitlements)..."
	@$(OUTPUT_BINARY)

#==============================================================================
# App Bundle Targets
#==============================================================================

app: | $(BIN_DIR)
	@echo "📦 Building $(APP_NAME).app bundle..."
	@rm -rf "$(APP_BUNDLE)"
	@mkdir -p "$(APP_BUNDLE)/Contents/MacOS"
	@mkdir -p "$(APP_BUNDLE)/Contents/Resources"
	@echo "🔨 Compiling application binary..."
	@$(SWIFTC) -o "$(APP_BUNDLE)/Contents/MacOS/$(PROJECT_NAME)" $(ALL_SOURCES) $(FRAMEWORKS) $(SWIFT_FLAGS_RELEASE)
	@echo "📄 Copying Info.plist..."
	@cp "$(INFO_PLIST)" "$(APP_BUNDLE)/Contents/Info.plist"
	@if [ -f "AppIcon.icns" ]; then \
		echo "🎨 Copying AppIcon.icns..."; \
		cp "AppIcon.icns" "$(APP_BUNDLE)/Contents/Resources/AppIcon.icns"; \
	fi
	@echo "🔏 Code signing app bundle..."
	@$(CODESIGN) $(SIGN_WITH_ENTITLEMENTS) "$(APP_BUNDLE)"
	@echo "✅ App bundle created: $(APP_BUNDLE)"

#==============================================================================
# Utility Targets
#==============================================================================

clean:
	@echo "🧹 Cleaning build artifacts..."
	@rm -f $(BIN_DIR)/$(PROJECT_NAME)
	@rm -f $(BIN_DIR)/$(PROJECT_NAME)-signed
	@rm -f $(BIN_DIR)/test-*
	@rm -rf "$(APP_BUNDLE)"
	@echo "✅ Clean complete"

check:
	@echo "🔍 Checking build environment..."
	@command -v $(SWIFTC) >/dev/null 2>&1 || (echo "❌ swiftc not found" && exit 1)
	@echo "✅ Swift compiler: $$($(SWIFTC) --version | head -1)"
	@command -v $(CODESIGN) >/dev/null 2>&1 || (echo "❌ codesign not found" && exit 1)
	@echo "✅ Code signing available"
	@test -f $(ENTITLEMENTS) || (echo "❌ Entitlements file not found: $(ENTITLEMENTS)" && exit 1)
	@echo "✅ Entitlements file exists: $(ENTITLEMENTS)"
	@echo "✅ Environment check passed"

verify: $(OUTPUT_BINARY)
	@echo "🔍 Verifying code signature and entitlements..."
	@echo "Code signature details:"
	@$(CODESIGN) -dv $(OUTPUT_BINARY) 2>&1 | grep -E "Identifier|TeamIdentifier|Signature|Authority" || true
	@echo ""
	@echo "Embedded entitlements:"
	@$(CODESIGN) -d --entitlements :- $(OUTPUT_BINARY) 2>/dev/null || echo "  (none - development build)"

install: release
	@echo "📦 Installing $(PROJECT_NAME) to /usr/local/bin..."
	@install -m 755 $(OUTPUT_BINARY) /usr/local/bin/$(PROJECT_NAME)
	@echo "✅ Installed to /usr/local/bin/$(PROJECT_NAME)"

help:
	@echo "tobari-signer-macos Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  make dev          - Build development version (fast, adhoc signed, no entitlements)"
	@echo "  make build        - Same as 'dev'"
	@echo "  make release      - Build with entitlements (required for smartcard access)"
	@echo "  make build-signed - Same as 'release'"
	@echo "  make app          - Build macOS app bundle (.app)"
	@echo "  make test         - Run test suite"
	@echo "  make run          - Build and run (development mode)"
	@echo "  make run-signed   - Build and run (release mode with smartcard access)"
	@echo "  make clean        - Remove all build artifacts"
	@echo "  make verify       - Verify code signature and entitlements"
	@echo "  make check        - Check build environment"
	@echo "  make install      - Install to /usr/local/bin (requires release build)"
	@echo "  make help         - Show this help message"
	@echo ""
	@echo "Build modes:"
	@echo "  Development - Fast compilation, debugging symbols, no entitlements"
	@echo "  Release     - Optimized, entitlements applied for smartcard access"
	@echo "  App Bundle  - Full macOS .app bundle with all resources and code signing"

#==============================================================================
# Directory Creation
#==============================================================================

$(BIN_DIR):
	@mkdir -p $(BIN_DIR)

#==============================================================================
# PHONY Targets
#==============================================================================

.PHONY: all dev build release build-signed test run run-signed clean help check verify install app
