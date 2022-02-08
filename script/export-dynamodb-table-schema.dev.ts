import fs from 'fs'
import path from 'path'
import { dynamoDBTableProps } from '../lib/dynamodb-table-props'

function main () {
  fs.writeFileSync(path.resolve(__dirname, '../src/schema/schema.json'), JSON.stringify(
    dynamoDBTableProps.map(tableProp => {
      const attributes = [tableProp.partitionKey]
      const keySchema = [{
        AttributeName: tableProp.partitionKey.name,
        KeyType: 'HASH'
      }]

      if (tableProp.sortKey) {
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
  ))
}

(main)()
