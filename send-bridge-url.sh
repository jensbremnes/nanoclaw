#!/bin/bash
# /home/jens/send-bridge-url.sh

# Wait for the bridge URL to appear in the logs
while true; do
  URL=$(journalctl -u claude-remote -n 20 --no-pager | grep -o 'https://claude.ai/code?bridge=\S*' | head -1)
  if [ -n "$URL" ]; then
    break
  fi
  sleep 2
done

# Send to your nanoclaw/discord agent
# Replace this with however you invoke nanoclaw
nanoclaw send "Claude remote session ready: $URL"
