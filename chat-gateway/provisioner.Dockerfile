FROM docker:27-cli

RUN apk add --no-cache nodejs

WORKDIR /app

COPY provisioner.mjs /app/provisioner.mjs
COPY chat-agent-template.json /app/chat-agent-template.json

ENTRYPOINT ["node", "/app/provisioner.mjs"]


