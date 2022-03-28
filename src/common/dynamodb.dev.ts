import {
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTableCommandInput
} from '@aws-sdk/client-dynamodb'
import { dynamoDBClient } from './dynamodb'
import { dynamoDBTableProps } from '../../lib/props/dynamodb-table-props'

export async function createTables (): Promise<void> {
  const dynamoDBTableSchema = dynamoDBTableProps.map(tableProp => {
    const attributes = [tableProp.partitionKey]
    const keySchema = [{
      AttributeName: tableProp.partitionKey.name,
      KeyType: 'HASH'
    }]

    if (tableProp.sortKey !== null) {
      attributes.push(tableProp.sortKey)
      keySchema.push({
        AttributeName: tableProp.sortKey.name,
        KeyType: 'RANGE'
      })
    }

    return {
      TableName: tableProp.tableName,
      AttributeDefinitions: attributes.map(attribute => {
        return {
          AttributeName: attribute.name,
          AttributeType: attribute.type
        }
      }),
      KeySchema: keySchema,
      ProvisionedThroughput: {
        ReadCapacityUnits: tableProp.readCapacity,
        WriteCapacityUnits: tableProp.writeCapacity
      }
    }
  })

  for (const tableSchema of dynamoDBTableSchema) {
    const input: DescribeTableCommandInput = { TableName: tableSchema.TableName }

    try {
      console.log('call describe table:', input)
      await dynamoDBClient.send(new DescribeTableCommand(input))
      return
    } catch (e) {
      if (e instanceof Error && e.name === 'ResourceNotFoundException' && input.TableName !== undefined) {
        console.log(`table ${input.TableName} is not exists.`)
      } else {
        throw e
      }
    }

    try {
      console.log('call create table:', tableSchema)
      await dynamoDBClient.send(new CreateTableCommand(tableSchema))
    } catch (e) {
      if (e instanceof Error && e.name === 'ResourceInUseException' && tableSchema.TableName !== undefined) {
        console.log(`table ${tableSchema.TableName} is already exists.`)
      } else {
        throw e
      }
    }
  }
}
