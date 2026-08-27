#!/bin/bash
KEY_FILE="$HOME/.ssh/id_ed25519_autoro"
scp -o StrictHostKeyChecking=no -i "$KEY_FILE" "$@"
