FROM --platform=linux/amd64 caddy@sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83

RUN addgroup -S -g 10001 proofline && \
    adduser -S -D -H -u 10001 -G proofline proofline && \
    mkdir -p /data/caddy /config/caddy && \
    chown -R 10001:10001 /data /config
COPY --chmod=0444 deploy/caddy/Caddyfile /etc/caddy/Caddyfile
USER 10001:10001
