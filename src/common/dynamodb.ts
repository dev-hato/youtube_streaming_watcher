import {
  AttributeValue,
  DynamoDBClient,
  DynamoDBClientConfig,
  ExecuteStatementCommand,
  ExecuteStatementCommandInput,
  ExecuteStatementCommandOutput
} from '@aws-sdk/client-dynamodb'

const dynamoDBClientConfig: DynamoDBClientConfig = {}

if (process.env.DYNAMODB_REGION !== undefined) {
  dynamoDBClientConfig.region = process.env.DYNAMODB_REGION
}

if (process.env.DYNAMODB_ENDPOINT !== undefined) {
  dynamoDBClientConfig.endpoint = process.env.DYNAMODB_ENDPOINT
}

if (process.env.NODE_ENV === 'development' && process.env.AWS_ACCESS_KEY_ID !== undefined && process.env.AWS_SECRET_ACCESS_KEY !== undefined) {
  dynamoDBClientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
}

export const dynamoDBClient = new DynamoDBClient(dynamoDBClientConfig)

export async function runQuery (partiQLQuery: string, parameters?: AttributeValue[]): Promise<ExecuteStatementCommandOutput | undefined> {
  const input: ExecuteStatementCommandInput = { Statement: partiQLQuery }

  if (parameters) {
    input.Parameters = parameters
  }

  try {
    console.log('run query: ', input)
    return await dynamoDBClient.send(new ExecuteStatementCommand(input))
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') {
      console.log(e)
    } else {
      throw e
    }
  }

  return undefined
}
