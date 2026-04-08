FROM atmoz/sftp:latest

COPY entrypoint.sh /usr/local/bin/campark-sftp-entrypoint.sh
COPY sshd_config /etc/ssh/sshd_config

RUN chmod +x /usr/local/bin/campark-sftp-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/campark-sftp-entrypoint.sh"]
