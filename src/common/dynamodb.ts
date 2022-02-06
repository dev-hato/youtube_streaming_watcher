import { promises as fs } from 'fs'
import {
  AttributeValue,
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTableCommandInput,
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
const schemaDir = 'schema'

async function createTable (tableName: string) {
  const tableSchema = JSON.parse((await fs.readFile(`${schemaDir}/${tableName}.json`)).toString())
  const input: DescribeTableCommandInput = { TableName: tableSchema.TableName }

  try {
    console.log('call describe table: ', input)
    await dynamoDBClient.send(new DescribeTableCommand(input))
    return
  } catch (e: any) {
    if (e.name === 'ResourceNotFoundException') {
      console.log(`table ${input.TableName} is not exists.`)
    } else {
      throw e
    }
  }

  try {
    console.log('call create table: ', tableSchema)
    await dynamoDBClient.send(new CreateTableCommand(tableSchema))
  } catch (e: any) {
    if (e.name === 'ResourceInUseException') {
      console.log(`table ${input.TableName} is already exists.`)
    } else {
      throw e
    }
  }
}

export async function createTables () {
  for (const tableFile of await fs.readdir(schemaDir)) {
    await createTable(tableFile.replace('.json', ''))
  }
}

export async function runQuery (partiQLQuery: string, parameters?: AttributeValue[]): Promise<ExecuteStatementCommandOutput | undefined> {
  const input: ExecuteStatementCommandInput = { Statement: partiQLQuery }

  if (parameters) {
    input.Parameters = parameters
  }

  try {
    console.log('run query: ', input)
    return await dynamoDBClient.send(new ExecuteStatementCommand(input))
  } catch (e: any) {
    if (e.name === 'ResourceNotFoundException') {
      console.log(e)
    } else {
      throw e
    }
  }
}
