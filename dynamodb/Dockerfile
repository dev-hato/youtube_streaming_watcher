FROM amazon/dynamodb-local:1.18.0

USER root

RUN yum install -y unzip \
    && curl "https://awscli.amazonaws.com/awscli-exe-linux-$(arch).zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && yum remove -y unzip \
    && yum clean all \
    && rm -rf awscliv2.zip aws \
    && chmod u-s /usr/bin/umount \
    && chmod g-s /usr/bin/umount \
    && chmod u-s /usr/bin/mount \
    && chmod g-s /usr/bin/mount \
    && chmod u-s /usr/libexec/dbus-1/dbus-daemon-launch-helper \
    && chmod g-s /usr/libexec/dbus-1/dbus-daemon-launch-helper \
    && chmod u-s /usr/bin/write \
    && chmod g-s /usr/bin/write \
    && chmod u-s /usr/bin/gpasswd \
    && chmod g-s /usr/bin/gpasswd \
    && chmod u-s /usr/bin/newgrp \
    && chmod g-s /usr/bin/newgrp \
    && chmod u-s /usr/sbin/unix_chkpwd \
    && chmod g-s /usr/sbin/unix_chkpwd \
    && chmod u-s /usr/libexec/utempter/utempter \
    && chmod g-s /usr/libexec/utempter/utempter \
    && chmod u-s /usr/bin/su \
    && chmod g-s /usr/bin/su \
    && chmod u-s /usr/sbin/pam_timestamp_check \
    && chmod g-s /usr/sbin/pam_timestamp_check \
    && chmod u-s /usr/bin/chage \
    && chmod g-s /usr/bin/chage

USER dynamodblocal

ARG AWS_ACCESS_KEY_ID="AWS_ACCESS_KEY_ID"
ENV AWS_ACCESS_KEY_ID ${AWS_ACCESS_KEY_ID}

ARG AWS_SECRET_ACCESS_KEY="AWS_SECRET_ACCESS_KEY"
ENV AWS_SECRET_ACCESS_KEY ${AWS_SECRET_ACCESS_KEY}

ARG AWS_REGION="ap-northeast-1"
ENV AWS_REGION ${AWS_REGION}

HEALTHCHECK --interval=5s --retries=20 CMD ["aws", "dynamodb", "list-tables", "--endpoint-url", "http://localhost:8000"]
