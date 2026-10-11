FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global --ignore-scripts @openai/codex@0.162.1 && npm cache clean --force
WORKDIR /opt/ads-runner
COPY scripts/macmini/ads-runner.sh scripts/macmini/ads-runner-launch.mjs ./
RUN chmod 0555 ads-runner.sh ads-runner-launch.mjs
USER node
ENV HOME=/home/node
ENTRYPOINT ["node", "/opt/ads-runner/ads-runner-launch.mjs"]
