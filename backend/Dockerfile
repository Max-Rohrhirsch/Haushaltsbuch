FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && pip3 install --no-cache-dir --break-system-packages pytr \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js pytr_bridge.py ./
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 4300
CMD ["node", "server.js"]
