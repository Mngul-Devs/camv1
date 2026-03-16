FROM stilliard/pure-ftpd

# Copy multi-user creation script
COPY create-users.sh /usr/local/bin/create-users.sh
RUN chmod +x /usr/local/bin/create-users.sh

# Ensure passwd directory exists
RUN mkdir -p /etc/pure-ftpd/passwd

# Custom entrypoint: create users then start pure-ftpd
COPY entrypoint.sh /usr/local/bin/campark-entrypoint.sh
RUN chmod +x /usr/local/bin/campark-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/campark-entrypoint.sh"]
