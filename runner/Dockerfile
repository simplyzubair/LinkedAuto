# Google Chrome is only published for amd64, which matches the DS723+ (AMD Ryzen).
FROM node:22-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /runner

# Separate layers so a late failure doesn't throw away the slow Chrome download.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN npx playwright install --with-deps chrome && rm -rf /var/lib/apt/lists/*
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify fonts-noto-color-emoji fonts-liberation \
 && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \
 && rm -rf /var/lib/apt/lists/*
# The base image already has user "node" with uid 1000; the browser runs as it.
RUN mkdir -p /data/profile && chown -R node:node /data

COPY src ./src
COPY start.sh ./
USER node
EXPOSE 6080
CMD ["./start.sh"]
