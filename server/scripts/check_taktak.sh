#!/bin/bash
# TakTak Watchtower - Node Monitoring Script
# Verifies if the node is synced and has peers

RPC_URL="http://localhost:9545"

# Check Peer Count
PEERS=$(curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":74}' $RPC_URL | jq -r '.result')

if [ "$PEERS" == "0x0" ] || [ -z "$PEERS" ]; then
  echo "$(date): [ALERTA] Nodo TakTak aislado (Peers: $PEERS). Reiniciando conexión..."
  # systemctl restart taktak-node # Uncomment in production
else
  echo "$(date): [INFO] Nodo saludable. Peers: $((PEERS))"
fi

# Check Sync Status
SYNCING=$(curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":75}' $RPC_URL | jq -r '.result')

if [ "$SYNCING" != "false" ]; then
  echo "$(date): [INFO] El nodo se está sincronizando..."
fi
