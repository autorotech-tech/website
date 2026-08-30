#!/bin/bash
KEY_FILE="$HOME/.ssh/id_ed25519_autoro"
ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" vladx@46.250.228.229 "$@"
