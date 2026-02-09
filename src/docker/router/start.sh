#!/bin/bash
set -e

# =============================================================================
# Chromatic Router - Self-Configuring Tailscale Subnet Router
# =============================================================================
# State is persisted to /var/lib/tailscale via Fly volume.
# On first run: creates ephemeral auth key, authenticates, approves routes.
# On restart: reuses existing state, no new device created.
# =============================================================================

echo "Router: Enabling IP Forwarding"
echo 'net.ipv4.ip_forward = 1' | tee -a /etc/sysctl.conf
echo 'net.ipv6.conf.all.forwarding = 1' | tee -a /etc/sysctl.conf
sysctl -p /etc/sysctl.conf

echo "Router: Starting Tailscaled"
/usr/local/bin/tailscaled \
  --state=/var/lib/tailscale/tailscaled.state \
  --socket=/var/run/tailscale/tailscaled.sock &

# Wait for tailscaled to be ready
sleep 3

echo "Router: Extracting Fly.io Subnet"
SUBNET=$(grep fly-local-6pn /etc/hosts | awk '{print $1}' | cut -d: -f1-3)::/48
echo "Router: Subnet ${SUBNET}"

# Check if already authenticated (state persisted from previous run)
if /usr/local/bin/tailscale status --json 2>/dev/null | jq -e '.BackendState == "Running"' > /dev/null 2>&1; then
  echo "Router: Already Authenticated (Using Persisted State)"

  # Just update the routes in case subnet changed
  /usr/local/bin/tailscale up \
    --hostname="${FLY_APP_NAME:-chromatic-router}" \
    --advertise-routes="${SUBNET}"
else
  # First run - need to authenticate
  if [ -n "${TAILSCALE_API_TOKEN}" ]; then
    echo "Router: Creating Auth Key (First Run)"

    AUTH_KEY_RESPONSE=$(curl -s -X POST \
      -u "${TAILSCALE_API_TOKEN}:" \
      -H "Content-Type: application/json" \
      -d '{
        "capabilities": {
          "devices": {
            "create": {
              "reusable": false,
              "ephemeral": false,
              "preauthorized": true
            }
          }
        },
        "expirySeconds": 300
      }' \
      "https://api.tailscale.com/api/v2/tailnet/-/keys")

    TAILSCALE_AUTHKEY=$(echo "${AUTH_KEY_RESPONSE}" | jq -r '.key')

    if [ -z "${TAILSCALE_AUTHKEY}" ] || [ "${TAILSCALE_AUTHKEY}" = "null" ]; then
      echo "Router: ERROR - Failed to Create Auth Key"
      echo "${AUTH_KEY_RESPONSE}"
      exit 1
    fi

    echo "Router: Auth Key Created"
  elif [ -z "${TAILSCALE_AUTHKEY}" ]; then
    echo "Router: ERROR - No TAILSCALE_API_TOKEN or TAILSCALE_AUTHKEY Provided"
    exit 1
  fi

  echo "Router: Authenticating to Tailscale"
  /usr/local/bin/tailscale up \
    --authkey="${TAILSCALE_AUTHKEY}" \
    --hostname="${FLY_APP_NAME:-chromatic-router}" \
    --advertise-routes="${SUBNET}"
fi

echo "Router: Getting Node Key"
NODE_KEY=$(/usr/local/bin/tailscale status --json | jq -r '.Self.PublicKey')
echo "Router: Node Key ${NODE_KEY}"

# Self-approve routes if we have API access
if [ -n "${TAILSCALE_API_TOKEN}" ]; then
  echo "Router: Finding Device ID"

  DEVICES_RESPONSE=$(curl -s \
    -u "${TAILSCALE_API_TOKEN}:" \
    "https://api.tailscale.com/api/v2/tailnet/-/devices")

  DEVICE_ID=$(echo "${DEVICES_RESPONSE}" | jq -r ".devices[] | select(.nodeKey == \"${NODE_KEY}\") | .id")

  if [ -n "${DEVICE_ID}" ] && [ "${DEVICE_ID}" != "null" ]; then
    echo "Router: Device ID ${DEVICE_ID}"
    echo "Router: Approving Subnet Routes"

    curl -s -X POST \
      -u "${TAILSCALE_API_TOKEN}:" \
      -H "Content-Type: application/json" \
      -d "{\"routes\": [\"${SUBNET}\"]}" \
      "https://api.tailscale.com/api/v2/device/${DEVICE_ID}/routes" > /dev/null

    echo "Router: Routes Approved"
  else
    echo "Router: WARNING - Could Not Find Device ID"
    echo "Router: Routes May Need Manual Approval"
  fi
fi

echo "Router: Fully Configured"
echo "Router: Starting DNS Proxy"
exec /usr/local/bin/dnsproxy -u fdaa::3 -p 53
