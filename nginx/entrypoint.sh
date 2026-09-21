#!/bin/sh
# Génère la configuration du serveur à partir de variables d'environnement, puis lance nginx.
set -eu

BACKEND_URL="${BACKEND_URL:-http://student-backend:3000}"
BACKEND_URL="${BACKEND_URL%/}"   # pas de slash final : il changerait le comportement de proxy_pass

# nginx n'utilise pas /etc/resolv.conf tout seul : on lui transmet les serveurs DNS du conteneur.
RESOLVER="$(awk '$1 == "nameserver" { if ($2 ~ /:/) printf "[%s] ", $2; else printf "%s ", $2 }' /etc/resolv.conf)"
RESOLVER="${RESOLVER% }"
RESOLVER="${RESOLVER:-127.0.0.11}"

sed -e "s|__BACKEND_URL__|${BACKEND_URL}|g" \
    -e "s|__RESOLVER__|${RESOLVER}|g" \
    /etc/nginx/server.conf.template > /tmp/server.conf

echo "frontend: proxy /api -> ${BACKEND_URL} (resolver: ${RESOLVER})"
exec "$@"
