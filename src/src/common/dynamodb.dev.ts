import {
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTableCommandInput
} from '@aws-sdk/client-dynamodb'
import { dynamoDBClient } from './dynamodb'
import dynamoDBTableSchema from '../../config/schema.json'

export async function createTables () {
  for (const tableSchema of dynamoDBTableSchema) {
    const input: DescribeTableCommandInput = { TableName: tableSchema.TableName }

    try {
      console.log('call describe table: ', input)
      await dynamoDBClient.send(new DescribeTableCommand(input))
      return
    } catch (e) {
      if (e.name === 'ResourceNotFoundException') {
        console.log(`table ${input.TableName} is not exists.`)
      } else {
        throw e
      }
    }

    try {
      console.log('call create table: ', tableSchema)
      await dynamoDBClient.send(new CreateTableCommand(tableSchema))
    } catch (e) {
      if (e.name === 'ResourceInUseException') {
        console.log(`table ${tableSchema.TableName} is already exists.`)
      } else {
        throw e
      }
    }
  }
}
