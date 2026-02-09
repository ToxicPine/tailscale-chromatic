# =============================================================================
# Chromatic Router - Tailscale Subnet Router for Fly.io
# =============================================================================

FROM alpine:3.23.3

ARG TAILSCALE_VERSION=1.94.1
ARG DNSPROXY_VERSION=0.78.2

RUN apk add --no-cache \
    bash \
    curl \
    jq \
    iptables \
    ip6tables

RUN curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_amd64.tgz" \
    | tar -xzf - -C /usr/local/bin --strip-components=1 \
    tailscale_${TAILSCALE_VERSION}_amd64/tailscale \
    tailscale_${TAILSCALE_VERSION}_amd64/tailscaled

RUN cd /tmp \
    && curl -fsSL "https://github.com/AdguardTeam/dnsproxy/releases/download/v${DNSPROXY_VERSION}/dnsproxy-linux-amd64-v${DNSPROXY_VERSION}.tar.gz" | tar -xzf - \
    && mv linux-amd64/dnsproxy /usr/local/bin/dnsproxy \
    && chmod +x /usr/local/bin/dnsproxy \
    && rm -rf linux-amd64

RUN mkdir -p /var/lib/tailscale /var/run/tailscale

COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
