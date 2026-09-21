# syntax=docker/dockerfile:1

# L'image de base est paramétrable (ex. miroir de registre interne) :
#   docker build --build-arg NGINX_IMAGE=registry.interne/nginxinc/nginx-unprivileged:1.28-alpine .
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.28-alpine
FROM ${NGINX_IMAGE}

USER root
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/server.conf.template /etc/nginx/server.conf.template
COPY nginx/entrypoint.sh /entrypoint.sh
COPY public /usr/share/nginx/html

RUN chmod 0755 /entrypoint.sh \
 && chgrp -R 0 /usr/share/nginx/html /etc/nginx \
 && chmod -R g=u /usr/share/nginx/html /etc/nginx

USER 101
ENV BACKEND_URL=http://student-backend:3000
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
