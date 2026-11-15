FROM nginx:alpine

RUN sed -i -E 's/listen[[:space:]]+80;/listen 8767;/' /etc/nginx/conf.d/default.conf

COPY index.html site.webmanifest /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
COPY lib /usr/share/nginx/html/lib
COPY src /usr/share/nginx/html/src

EXPOSE 8767
