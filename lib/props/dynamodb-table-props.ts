import { aws_dynamodb as dynamodb } from 'aws-cdk-lib'

export const dynamoDBTableProps: dynamodb.TableProps[] = [
  {
    tableName: 'youtube_streaming_watcher_channels',
    partitionKey: { name: 'channel_id', type: dynamodb.AttributeType.STRING },
    readCapacity: 1,
    writeCapacity: 1
  },
  {
    tableName: 'youtube_streaming_watcher_next_notification_times',
    partitionKey: { name: 'next_notification_at', type: dynamodb.AttributeType.STRING },
    readCapacity: 1,
    writeCapacity: 1
  },
  {
    tableName: 'youtube_streaming_watcher_notified_videos',
    partitionKey: { name: 'channel_id', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'video_id', type: dynamodb.AttributeType.STRING },
    readCapacity: 3,
    writeCapacity: 1
  },
  {
    tableName: 'youtube_streaming_watcher_received_slack_requests',
    partitionKey: { name: 'ts', type: dynamodb.AttributeType.STRING },
    readCapacity: 1,
    writeCapacity: 1
  }
]
