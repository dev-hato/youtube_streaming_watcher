import {
  AttributeValue,
  DynamoDBClient,
  DynamoDBClientConfig,
  ExecuteStatementCommand,
  ExecuteStatementCommandInput
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

export async function runQuery (partiQLQuery: string, parameters?: AttributeValue[]): Promise<Array<{ [key: string]: AttributeValue }>> {
  const input: ExecuteStatementCommandInput = { Statement: partiQLQuery }

  if (parameters !== null) {
    input.Parameters = parameters
  }

  let results: Array<{ [key: string]: AttributeValue }> = []

  try {
    while (true) {
      console.log('run query:', input)
      const result = await dynamoDBClient.send(new ExecuteStatementCommand(input))
      const items = result.Items

      if (items === undefined) {
        break
      }

      results = results.concat(items)
      const nextToken = result.NextToken

      if (nextToken === undefined) {
        break
      }

      input.NextToken = nextToken
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'ResourceNotFoundException') {
      console.log(e)
    } else {
      throw e
    }
  }

  return results
}
