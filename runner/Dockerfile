# Google Chrome is only published for amd64, which matches the DS723+ (AMD Ryzen).
FROM node:22-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /runner
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npx playwright install --with-deps chrome \
 && apt-get update \
 && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify fonts-noto-color-emoji fonts-liberation \
 && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1000 runner \
 && mkdir -p /data/profile && chown -R runner /data
COPY src ./src
COPY start.sh ./
USER runner
EXPOSE 6080
CMD ["./start.sh"]
