#!/bin/bash

echo "Generating icons for Chrome Extension..."

cd extension/icons

# Convert and resize the SVG to PNG
sips -z 16 16 -s format png ../../client/public/favicon.svg --out icon16.png
sips -z 48 48 -s format png ../../client/public/favicon.svg --out icon48.png
sips -z 128 128 -s format png ../../client/public/favicon.svg --out icon128.png

echo "Icons generated successfully! Please reload the extension in Chrome (chrome://extensions)."
