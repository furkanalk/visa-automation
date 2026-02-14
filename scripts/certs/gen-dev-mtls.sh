#!/usr/bin/env bash
# Generate self-signed CA + server + client certs for Postgres mTLS (dev only).
# Output: scripts/certs/dev-mtls/ (ca.pem, server.crt, server.key, client.crt, client.key)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/dev-mtls"
mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

# CA
openssl req -x509 -newkey rsa:4096 -days 365 -nodes \
  -keyout ca.key -out ca.pem -subj "/CN=dev-mtls-ca"

# Server
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr \
  -subj "/CN=localhost"
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial \
  -out server.crt -days 365
rm -f server.csr

# Client
openssl req -newkey rsa:2048 -nodes -keyout client.key -out client.csr \
  -subj "/CN=visa-automation-client"
openssl x509 -req -in client.csr -CA ca.pem -CAkey ca.key -CAcreateserial \
  -out client.crt -days 365
rm -f client.csr

rm -f ca.key ca.srl
chmod 600 server.key client.key 2>/dev/null || true

echo "Dev mTLS certs written to $OUT_DIR"
echo "  CA:   ca.pem"
echo "  Server: server.crt, server.key"
echo "  Client: client.crt, client.key"
echo "Use DB_SSL_CA_PATH=$OUT_DIR/ca.pem and (optional) DB_SSL_CERT_PATH/DB_SSL_KEY_PATH for client cert."
