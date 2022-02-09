import * as cdk from '@aws-cdk/core'
import * as apigateway from '@aws-cdk/aws-apigateway'
import * as dynamodb from '@aws-cdk/aws-dynamodb'
import * as events from '@aws-cdk/aws-events'
import * as targets from '@aws-cdk/aws-events-targets'
import * as lambda from '@aws-cdk/aws-lambda'
import * as logs from '@aws-cdk/aws-logs'
import * as secretmanager from '@aws-cdk/aws-secretsmanager'
import { dynamoDBTableProps } from './dynamodb-table-props'
import { rate } from './events-rule-props'

export class CdkStack extends cdk.Stack {
  constructor (scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const slackSecret = secretmanager.Secret.fromSecretNameV2(
      this,
      'Secret-slack',
      'youtube_streaming_watcher_slack'
    )
    const youtubeSecret = secretmanager.Secret.fromSecretNameV2(
      this,
      'Secret-youtube',
      'youtube_streaming_watcher_youtube'
    )
    const functionData = Object.fromEntries(['notify', 'reply'].map(functionName => [
      functionName,
      new lambda.Function(this, `Function-${functionName}`, {
        functionName: `youtube_streaming_watcher_${functionName}_function`,
        code: lambda.Code.fromAsset('src/youtube_streaming_watcher.zip'),
        handler: `dist/lambda/${functionName}.handler`,
        runtime: lambda.Runtime.NODEJS_14_X,
        environment: {
          SLACK_BOT_TOKEN: slackSecret.secretValueFromJson('slack_bot_token').toString(),
          SLACK_CHANNEL: slackSecret.secretValueFromJson('slack_channel').toString(),
          SLACK_SIGNING_SECRET: slackSecret.secretValueFromJson('slack_signing_secret').toString(),
          YOUTUBE_API_KEY: youtubeSecret.secretValueFromJson('youtube_api_key').toString()
        }
      })
    ]))
    new events.Rule(this, 'EventsRule-notify', { // eslint-disable-line no-new
      schedule: events.Schedule.rate(rate),
      targets: [new targets.LambdaFunction(functionData.notify)]
    })
    new apigateway.LambdaRestApi(this, 'APIGateway-reply', { // eslint-disable-line no-new
      restApiName: 'youtube_streaming_watcher_reply_api',
      handler: functionData.reply,
      deployOptions: {
        dataTraceEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(
          new logs.LogGroup(this, 'Log-apigateway_reply', {
            logGroupName: '/aws/apigateway/youtube_streaming_watcher_reply_api/access_log'
          })
        ),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields()
      }
    })
    const functions = Object.values(functionData)

    for (const tableProp of dynamoDBTableProps) {
      const table = new dynamodb.Table(this, `DynamoDBTable-${tableProp.tableName}`, tableProp)
      for (const func of functions) {
        table.grant(
          func,
          'dynamodb:CreateTable',
          'dynamodb:DescribeTable',
          'dynamodb:PartiQLInsert',
          'dynamodb:PartiQLSelect',
          'dynamodb:PartiQLDelete'
        )
      }
    }
  }
}
