FROM node:18-alpine
WORKDIR /app
ARG VERSION
ENV VERSION $VERSION
COPY docker/entrypoint.sh /entrypoint.sh
RUN npm i -g hfs@${VERSION}
RUN chmod +x /entrypoint.sh && chmod 500 /entrypoint.sh

ENTRYPOINT [ "/bin/sh", "-C", "/entrypoint.sh" ]