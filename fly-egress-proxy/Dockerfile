# fly-egress-proxy/Dockerfile
# ---------------------------------------------------------------------------
# Minimal tinyproxy forward-proxy image for the Fly.io static-egress app.
#
# Design note (mirrors analytics-service/Dockerfile's CMD-override note):
# the BasicAuth credential is NOT baked into this image. tinyproxy.conf.template
# ships with placeholders only; entrypoint.sh renders the real config from the
# PROXY_BASIC_AUTH fly secret at container start (fail-loud if it is missing).
# This keeps the secret out of both git history AND the image layers.
#
# The container starts as root so entrypoint.sh can write the rendered config to
# /etc/tinyproxy; tinyproxy itself then drops to the unprivileged tinyproxy
# user/group via the `User`/`Group` directives in the rendered config.
# ---------------------------------------------------------------------------
FROM alpine:3.20

# tinyproxy from the signed Alpine distro repo — no npm/PyPI supply-chain surface.
# The apk package also provisions the `tinyproxy` user/group and /etc/tinyproxy.
RUN apk add --no-cache tinyproxy

COPY tinyproxy.conf.template /opt/egress-proxy/tinyproxy.conf.template
COPY entrypoint.sh /opt/egress-proxy/entrypoint.sh
RUN chmod +x /opt/egress-proxy/entrypoint.sh

# Destination allow-list (F4). Carries NO secret, so — unlike the auth-bearing
# config — it is baked directly into the image at the path the rendered
# tinyproxy.conf references via `Filter "/etc/tinyproxy/filter"`. World-readable
# (0644) so tinyproxy can read it after dropping to the unprivileged user.
COPY tinyproxy.filter /etc/tinyproxy/filter

# Raw-TCP proxy port; declared in fly.toml as a handler-less service.
EXPOSE 8888

ENTRYPOINT ["/opt/egress-proxy/entrypoint.sh"]
