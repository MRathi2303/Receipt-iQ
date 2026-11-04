# Local infrastructure

I use LocalStack to run the AWS pieces locally without connecting to my AWS
account.

`docker compose up --build` starts LocalStack, creates the development S3
bucket and DynamoDB tables through
[`localstack/init-aws.sh`](./localstack/init-aws.sh), and starts the API and
frontend.

LocalStack is only for development. In AWS, the application uses the real S3,
DynamoDB, SQS, Lambda, and API Gateway resources described in
[`docs/AWS-INFRASTRUCTURE.md`](../docs/AWS-INFRASTRUCTURE.md).

When `AWS_ENDPOINT_URL` is set, the AWS SDK clients use the local endpoint.
That variable must remain unset for a real AWS deployment.
