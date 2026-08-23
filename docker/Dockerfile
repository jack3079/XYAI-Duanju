# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS source
WORKDIR /work
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY base/XiaoyuDrama-Core/ /work/core/
COPY base/XiaoyuDrama-Web/ /work/web/
COPY docker/patchkit/ /tmp/patchkit-parts/

RUN cat /tmp/patchkit-parts/part-*.txt | tr -d '\r\n' > /tmp/patchkit.b64 \
    && base64 -d /tmp/patchkit.b64 > /tmp/patchkit.tar.xz \
    && echo 'c47e45329687bfc5fb9ca44aaf2d199d2f515101dfb470582bb6986d35e401b0  /tmp/patchkit.tar.xz' | sha256sum -c - \
    && mkdir -p /tmp/patchkit \
    && tar -xJf /tmp/patchkit.tar.xz -C /tmp/patchkit \
    && PKROOT="$(dirname "$(find /tmp/patchkit -name postfix.py -type f -print -quit)")" \
    && test -n "$PKROOT" \
    && PATCHER="$PKROOT/tools/apply_xiaoyu_core_patch.py" \
    && HELP="$(python3 "$PATCHER" --help 2>&1 || true)" \
    && set -- --app-root /work/core --web-root /work/web \
    && if echo "$HELP" | grep -q -- '--overlay-root'; then set -- "$@" --overlay-root "$PKROOT/xiaoyu-overlay"; fi \
    && if echo "$HELP" | grep -q -- '--update-public-key-b64'; then set -- "$@" --update-public-key-b64 ''; fi \
    && if echo "$HELP" | grep -q -- '--app-version'; then set -- "$@" --app-version '0.0.1'; fi \
    && if echo "$HELP" | grep -q -- '--version' && ! echo "$HELP" | grep -q -- '--app-version'; then set -- "$@" --version '0.0.1'; fi \
    && if echo "$HELP" | grep -q -- '--source-commit'; then set -- "$@" --source-commit 'bc61ec7a1b5df31293b286981a5f4ad4635464ee'; fi \
    && if echo "$HELP" | grep -q -- '--web-source-commit'; then set -- "$@" --web-source-commit '9c4cb0ec7d4f6b4067c7768e2df8cdc7f8587214'; fi \
    && if echo "$HELP" | grep -q -- '--core-source-commit'; then set -- "$@" --core-source-commit 'bc61ec7a1b5df31293b286981a5f4ad4635464ee'; fi \
    && PYTHONPATH="$PKROOT/tools${PYTHONPATH:+:$PYTHONPATH}" python3 "$PATCHER" "$@"

COPY XiaoyuDrama-Core/ /work/core/
COPY XiaoyuDrama-Web/ /work/web/
RUN rm -rf /work/core/node_modules /work/core/dist /work/core/build \
        /work/web/node_modules /work/web/dist /work/web/build \
    && rm -f '/work/core/src/socket/resTool copy.ts' \
        '/work/web/src/utils/useChat copy.ts' \
        '/work/web/src/views/production/components/workbench/generate copy.vue' \
        '/work/web/src/views/production/components/workbench/generate copy/components/trackList.vue' \
        '/work/web/src/views/production/components/workbench/generate copy/components/videogenerate.vue' \
        '/work/web/src/views/production/components/workbench/generate copy/index.vue' \
        '/work/web/src/views/scriptAgent/index copy.vue'

FROM node:24-bookworm-slim AS backend
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare yarn@1.22.22 --activate
COPY --from=source /work/core/package.json /work/core/yarn.lock ./
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));for(const s of ['dependencies','devDependencies']){if(!p[s])continue;for(const n of ['custom-electron-titlebar','electron','electron-builder','electron-rebuild','electronmon'])delete p[s][n]}fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\\n')" \
    && yarn install --frozen-lockfile
COPY --from=source /work/core/ ./
ENV NODE_ENV=dev
ENV XIAOYU_DATA_DIR=/var/lib/xiaoyu
EXPOSE 10588
CMD ["yarn", "tsx", "src/app.ts"]

FROM node:24-bookworm-slim AS web
WORKDIR /app
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
COPY --from=source /work/web/package.json /work/web/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY --from=source /work/web/ ./
EXPOSE 50188
CMD ["yarn", "dev", "--host", "0.0.0.0", "--port", "50188"]
