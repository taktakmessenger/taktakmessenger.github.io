#!/bin/bash
# TakTak Certificate Authority & Node Certificate Generator
# Used for mTLS authentication between TakTak nodes

mkdir -p certs
cd certs

# 1. Generate CA Private Key and Certificate
openssl genrsa -out taktak-ca.key 4096
openssl req -x509 -new -nodes -key taktak-ca.key -sha256 -days 3650 -out taktak-ca.crt \
    -subj "/C=TK/ST=Network/L=Decentralized/O=TakTak Ecosystem/CN=TakTak CA"

echo "CA de TakTak generada exitosamente."

# 2. Function to generate a certificate for a node
generate_node_cert() {
    NODE_ID=$1
    echo "Generando certificado para el nodo: $NODE_ID"
    
    openssl genrsa -out $NODE_ID.key 2048
    openssl req -new -key $NODE_ID.key -out $NODE_ID.csr \
        -subj "/C=TK/ST=Network/L=Decentralized/O=TakTak Nodes/CN=$NODE_ID"
    
    openssl x509 -req -in $NODE_ID.csr -CA taktak-ca.crt -CAkey taktak-ca.key -CAcreateserial \
        -out $NODE_ID.crt -days 365 -sha256
}

# Generate certificate for Master Node
generate_node_cert "master-node"

echo "Certificados listos en la carpeta /server/certs"
