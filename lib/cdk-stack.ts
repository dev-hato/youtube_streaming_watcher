import * as cdk from '@aws-cdk/core'
import * as apigateway from '@aws-cdk/aws-apigateway'
import * as dynamodb from '@aws-cdk/aws-dynamodb'
import * as events from '@aws-cdk/aws-events'
import * as iam from '@aws-cdk/aws-iam'
import * as targets from '@aws-cdk/aws-events-targets'
import * as lambda from '@aws-cdk/aws-lambda'
import * as lambdaNode from '@aws-cdk/aws-lambda-nodejs'
import * as logs from '@aws-cdk/aws-logs'
import * as secretmanager from '@aws-cdk/aws-secretsmanager'
import { dynamoDBTableProps } from './props/dynamodb-table-props'
import { rate } from './props/events-rule-props'
import { functionProps } from './props/function-props'

export class CdkStack extends cdk.Stack {
  constructor (scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const cdkSecret = secretmanager.Secret.fromSecretNameV2(
      this,
      'Secret-cdk',
      'youtube_streaming_watcher_cdk'
    )
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
    const environment = {
      SLACK_BOT_TOKEN: slackSecret.secretValueFromJson('slack_bot_token').toString(),
      SLACK_CHANNEL: slackSecret.secretValueFromJson('slack_channel').toString(),
      SLACK_SIGNING_SECRET: slackSecret.secretValueFromJson('slack_signing_secret').toString(),
      TZ: 'Asia/Tokyo',
      YOUTUBE_API_KEY: youtubeSecret.secretValueFromJson('youtube_api_key').toString()
    }
    const functionData = Object.fromEntries(Object.entries(functionProps).map(([key, value]) => [
      key,
      new lambdaNode.NodejsFunction(this, `Function-${key}`, Object.assign(value, {
        runtime: lambda.Runtime.NODEJS_14_X,
        bundling: { minify: true },
        environment
      }))
    ]))
    const rule = new events.Rule(this, 'EventsRule-notify', {
      schedule: events.Schedule.rate(rate),
      targets: [new targets.LambdaFunction(functionData.notify)]
    })
    const apiAccessLogGroup = new logs.LogGroup(this, 'Log-apigateway_reply', {
      logGroupName: '/aws/apigateway/youtube_streaming_watcher_reply_api/access_log',
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT
    })
    const api = new apigateway.LambdaRestApi(this, 'APIGateway-reply', {
      restApiName: 'youtube_streaming_watcher_reply_api',
      handler: functionData.reply,
      deployOptions: {
        dataTraceEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiAccessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields()
      }
    })

    const functions = Object.values(functionData)
    const tableArns: string[] = []

    for (const tableProp of dynamoDBTableProps) {
      const table = new dynamodb.Table(this, `DynamoDBTable-${tableProp.tableName}`, Object.assign(tableProp, {
        removalPolicy: cdk.RemovalPolicy.DESTROY
      }))

      for (const func of functions) {
        table.grant(
          func,
          'dynamodb:CreateTable',
          'dynamodb:DescribeTable',
          'dynamodb:PartiQLInsert',
          'dynamodb:PartiQLSelect',
          'dynamodb:PartiQLDelete',
          'dynamodb:PartiQLUpdate'
        )
      }

      tableArns.push(table.tableArn)
    }

    const oidcAud = 'sts.amazonaws.com'
    const provider = new iam.OpenIdConnectProvider(this, 'OIDCProvider-github', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: [oidcAud]
    })

    const managedPolicies: iam.IManagedPolicy[] = [
      'AmazonDynamoDBReadOnlyAccess',
      'AmazonS3ReadOnlyAccess',
      'AWSCloudFormationReadOnlyAccess',
      'AmazonEventBridgeReadOnlyAccess',
      'AWSLambda_ReadOnlyAccess'
    ].map(name => iam.ManagedPolicy.fromAwsManagedPolicyName(name))
    const oidcSubBase = 'repo:dev-hato/youtube_streaming_watcher'
    const assumeRoleAction = 'sts:AssumeRoleWithWebIdentity'

    const cdkDiffRole = new iam.Role(this, 'Role-cdk_diff', {
      roleName: 'youtube_streaming_watcher_cdk_diff',
      assumedBy: new iam.FederatedPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:sub': oidcSubBase + ':pull_request',
            'token.actions.githubusercontent.com:aud': oidcAud
          }
        },
        assumeRoleAction
      ),
      managedPolicies
    })

    const iamPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'iam:AttachRolePolicy',
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:DeleteRolePolicy',
        'iam:DetachRolePolicy',
        'iam:PassRole',
        'iam:PutRolePolicy'
      ]
    })

    const cdkDeployRoleName = 'youtube_streaming_watcher_cdk_deploy'
    const iamPolicyArns = [
      functionData.notify.role?.roleArn,
      functionData.reply.role?.roleArn,
      cdkDiffRole.roleArn,
      `arn:aws:iam::${this.account}:role/${cdkDeployRoleName}`,
      `arn:aws:iam::${this.account}:role/${id.slice(0, 24)}*`
    ]

    for (const arn of iamPolicyArns) {
      if (arn !== undefined) {
        iamPolicy.addResources(arn)
      }
    }

    const cdkDeployRole = new iam.Role(this, 'Role-cdk_deploy', {
      roleName: 'youtube_streaming_watcher_cdk_deploy',
      assumedBy: new iam.FederatedPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:sub': oidcSubBase + ':ref:refs/heads/main',
            'token.actions.githubusercontent.com:aud': oidcAud
          }
        },
        assumeRoleAction
      ),
      managedPolicies
    })
    cdkDeployRole.addManagedPolicy(new iam.ManagedPolicy(this, 'Policy-cdk_deploy', {
      managedPolicyName: cdkDeployRoleName,
      statements: [
        iamPolicy,
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:PutObject'],
          resources: [`arn:aws:s3:::${cdkSecret.secretValueFromJson('asset_s3_bucket_name').toString()}/assets/*`]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['apigateway:PATCH'],
          resources: [`arn:aws:apigateway:${this.region}::/account`]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'apigateway:DELETE',
            'apigateway:POST',
            'apigateway:PUT',
            'apigateway:PATCH',
            'apigateway:Get*'
          ],
          resources: [api.arnForExecuteApi()]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [
            cdkSecret,
            slackSecret,
            youtubeSecret
          ].map(s => s.secretArn + '*')
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'cloudformation:DeleteStack',
            'cloudformation:CreateChangeSet',
            'cloudformation:ExecuteChangeSet',
            'cloudformation:DeleteChangeSet'
          ],
          resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/${id}/*`]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'events:RemoveTargets',
            'events:DeleteRule',
            'events:PutRule',
            'events:PutTargets'
          ],
          resources: [rule.ruleArn]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'lambda:AddPermission',
            'lambda:CreateFunction',
            'lambda:RemovePermission',
            'lambda:DeleteFunction',
            'lambda:UpdateFunctionCode',
            'lambda:UpdateFunctionConfiguration'
          ],
          resources: Object.values(functionData).map(f => f.functionArn)
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:CreateTable',
            'dynamodb:DeleteTable'
          ],
          resources: tableArns
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:PutRetentionPolicy',
            'logs:DeleteLogGroup'
          ],
          resources: [apiAccessLogGroup.logGroupArn]
        })
      ]
    }))
  }
}
