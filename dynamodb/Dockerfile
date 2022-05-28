FROM amazon/dynamodb-local:1.18.0

USER root

RUN yum install -y unzip \
    && curl "https://awscli.amazonaws.com/awscli-exe-linux-$(arch).zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && yum clean all \
    && rm -rf awscliv2.zip aws

USER dynamodblocal

ARG AWS_ACCESS_KEY_ID="AWS_ACCESS_KEY_ID"
ENV AWS_ACCESS_KEY_ID ${AWS_ACCESS_KEY_ID}

ARG AWS_SECRET_ACCESS_KEY="AWS_SECRET_ACCESS_KEY"
ENV AWS_SECRET_ACCESS_KEY ${AWS_SECRET_ACCESS_KEY}

ARG AWS_REGION="ap-northeast-1"
ENV AWS_REGION ${AWS_REGION}

HEALTHCHECK --interval=5s --retries=20 CMD ["aws", "dynamodb", "list-tables", "--endpoint-url", "http://localhost:8000"]
