# Local infrastructure

ReceiptIQ uses [LocalStack](https://localstack.cloud/) in development to emulate
the AWS services used by the application:

- S3 for uploaded receipt files
- DynamoDB for users and receipt metadata

`docker compose up --build` starts LocalStack, initializes the resources through
[`init-aws.sh`](./localstack/init-aws.sh), and then starts the API and frontend.
No AWS account or credentials are required.

The AWS SDK clients use `AWS_ENDPOINT_URL` when it is set. Leave that variable
unset in a real AWS deployment.
