#!/bin/sh
echo "CDP: Starting Chrome Headless"
# Bind to 0.0.0.0 for Flycast compatibility (Fly Proxy handles IPv6 translation)
exec chromium-browser \
  --headless \
  --disable-gpu \
  --no-sandbox \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  --remote-allow-origins=* \
  --disable-dev-shm-usage \
  --disable-software-rasterizer \
  --disable-background-networking \
  --disable-default-apps \
  --disable-extensions \
  --disable-sync \
  --disable-translate \
  --mute-audio \
  --no-first-run \
  --safebrowsing-disable-auto-update \
  --hide-scrollbars \
  --metrics-recording-only \
  --no-zygote \
  --single-process
