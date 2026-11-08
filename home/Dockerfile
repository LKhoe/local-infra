# Static landing page for https://www.khoe.dev, served by nginx as a non-root user on port 8080.
# The Cloudflare tunnel reaches it at http://localinfra-home:8080 (no published port).
FROM nginxinc/nginx-unprivileged:1.28.2-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
