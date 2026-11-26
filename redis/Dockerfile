ARG REDIS_VERSION=8.12
FROM redis:${REDIS_VERSION}-alpine

# Redis 8 images load RediSearch, JSON, TimeSeries and Bloom on every start (the entrypoint adds
# --loadmodule for each .so here). No app uses them: remove them to save memory/threads on the Pi
# and keep their commands out of the per-project ACL users. (Vector sets are built in; they stay.)
RUN rm -f /usr/local/lib/redis/modules/*.so

COPY start.sh /usr/local/bin/localinfra-redis-start
RUN chmod 755 /usr/local/bin/localinfra-redis-start

ENTRYPOINT ["localinfra-redis-start"]
CMD []
