#!/bin/bash
set -e

SOURCE="AppIcon_Source.png"
ICONSET="AppIcon.iconset"

if [ ! -f "$SOURCE" ]; then
    echo "Error: Source image $SOURCE not found."
    exit 1
fi

mkdir -p $ICONSET

echo "Generating icons..."

# 16x16
sips -s format png -z 16 16     $SOURCE --out ${ICONSET}/icon_16x16.png > /dev/null
sips -s format png -z 32 32     $SOURCE --out ${ICONSET}/icon_16x16@2x.png > /dev/null
# 32x32
sips -s format png -z 32 32     $SOURCE --out ${ICONSET}/icon_32x32.png > /dev/null
sips -s format png -z 64 64     $SOURCE --out ${ICONSET}/icon_32x32@2x.png > /dev/null
# 128x128
sips -s format png -z 128 128   $SOURCE --out ${ICONSET}/icon_128x128.png > /dev/null
sips -s format png -z 256 256   $SOURCE --out ${ICONSET}/icon_128x128@2x.png > /dev/null
# 256x256
sips -s format png -z 256 256   $SOURCE --out ${ICONSET}/icon_256x256.png > /dev/null
sips -s format png -z 512 512   $SOURCE --out ${ICONSET}/icon_256x256@2x.png > /dev/null
# 512x512
sips -s format png -z 512 512   $SOURCE --out ${ICONSET}/icon_512x512.png > /dev/null
sips -s format png -z 1024 1024 $SOURCE --out ${ICONSET}/icon_512x512@2x.png > /dev/null

echo "Combining into .icns..."
iconutil -c icns $ICONSET
rm -rf $ICONSET

echo "✅ Generated AppIcon.icns"
