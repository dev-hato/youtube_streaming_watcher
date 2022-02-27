import { Construct } from 'constructs'
import {
  BOOTSTRAP_QUALIFIER_CONTEXT,
  DefaultStackSynthesizer,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_apigateway as apigateway,
  aws_chatbot as chatbot,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_dynamodb as dynamodb,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNode,
  aws_logs as logs,
  aws_s3 as s3,
  aws_sns as sns,
  aws_ssm as ssm
} from 'aws-cdk-lib'
import { dynamoDBTableProps } from './props/dynamodb-table-props'
import { rate } from './props/events-rule-props'
import { functionProps } from './props/function-props'

export class CdkStack extends Stack {
  constructor (scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const secrets: { [secretName: string]: ssm.IStringParameter } = {
      slackBotToken: ssm.StringParameter.fromSecureStringParameterAttributes(
        this,
        'Secret-slack_bot_token',
        {
          parameterName: '/youtube_streaming_watcher_slack/slack_bot_token'
        }
      ),
      slackChannel: ssm.StringParameter.fromStringParameterName(
        this,
        'Secret-slack_channel',
        '/youtube_streaming_watcher_slack/slack_channel'
      ),
      slackSigningSecret: ssm.StringParameter.fromSecureStringParameterAttributes(
        this,
        'Secret-slack_signing_secret',
        {
          parameterName: '/youtube_streaming_watcher_slack/slack_signing_secret'
        }
      ),
      slackAlertWorkspaceId: ssm.StringParameter.fromStringParameterName(
        this,
        'Secret-slack_alert_workspace_id',
        '/youtube_streaming_watcher_slack_alert/workspace_id'
      ),
      slackAlertChannelId: ssm.StringParameter.fromStringParameterName(
        this,
        'Secret-slack_alert_channel_id',
        '/youtube_streaming_watcher_slack_alert/channel_id'
      ),
      youtubeApiKey: ssm.StringParameter.fromSecureStringParameterAttributes(
        this,
        'Secret-youtube_api_key',
        {
          parameterName: '/youtube_streaming_watcher_youtube/youtube_api_key'
        }
      )
    }
    const environment = {
      NODE_OPTIONS: '--unhandled-rejections=strict',
      SLACK_BOT_TOKEN: secrets.slackBotToken.stringValue,
      SLACK_CHANNEL: secrets.slackChannel.stringValue,
      SLACK_SIGNING_SECRET: secrets.slackSigningSecret.stringValue,
      TZ: 'Asia/Tokyo',
      YOUTUBE_API_KEY: secrets.youtubeApiKey.stringValue
    }
    const functionDataEntities: [string, lambdaNode.NodejsFunction][] = Object.entries(functionProps).map(([key, value]) => [
      key,
      new lambdaNode.NodejsFunction(this, `Function-${key}`, Object.assign(value, {
        runtime: lambda.Runtime.NODEJS_14_X,
        bundling: { minify: true },
        environment
      }))
    ])
    const functionData = Object.fromEntries(functionDataEntities)
    const lambdaSNSTopic = new sns.Topic(this, 'SNSTopic-lambda')
    const lambdaSNSTopicAction = new cloudwatchActions.SnsAction(lambdaSNSTopic)
    const alarmArns = []

    for (const [key, func] of functionDataEntities) {
      const alarm = new cloudwatch.Alarm(this, `Alarm-lambda_${key}`, {
        evaluationPeriods: 1,
        metric: func.metric('Errors', {
          statistic: cloudwatch.Statistic.AVERAGE,
          period: Duration.minutes(5)
        }),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.IGNORE
      })
      alarm.addOkAction(lambdaSNSTopicAction)
      alarm.addAlarmAction(lambdaSNSTopicAction)
      alarmArns.push(alarm.alarmArn)
    }

    const chatbotSlackChannelConfig = new chatbot.SlackChannelConfiguration(this, 'ChatbotSlackChannelConfig-default', {
      slackChannelConfigurationName: 'youtube_streaming_watcher_slack',
      slackWorkspaceId: secrets.slackAlertWorkspaceId.stringValue,
      slackChannelId: secrets.slackAlertChannelId.stringValue,
      notificationTopics: [lambdaSNSTopic]
    })
    const rule = new events.Rule(this, 'EventsRule-notify', {
      schedule: events.Schedule.rate(rate),
      targets: [new targets.LambdaFunction(functionData.notify)]
    })
    const apiAccessLogGroup = new logs.LogGroup(this, 'Log-apigateway_reply', {
      logGroupName: '/aws/apigateway/youtube_streaming_watcher_reply_api/access_log',
      removalPolicy: RemovalPolicy.SNAPSHOT
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
    const oidcAud = 'sts.amazonaws.com'
    const provider = new iam.OpenIdConnectProvider(this, 'OIDCProvider-github', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: [oidcAud]
    })

    const qualifier = this.node.tryGetContext(BOOTSTRAP_QUALIFIER_CONTEXT) ?? DefaultStackSynthesizer.DEFAULT_QUALIFIER
    const apiArn = `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/*`
    const managedPolicies: iam.IManagedPolicy[] = [
      'AmazonDynamoDBReadOnlyAccess',
      'AmazonS3ReadOnlyAccess',
      'AmazonSNSReadOnlyAccess',
      'AWSCloudFormationReadOnlyAccess',
      'AmazonEventBridgeReadOnlyAccess',
      'AWSLambda_ReadOnlyAccess',
      'IAMReadOnlyAccess'
    ].map(name => iam.ManagedPolicy.fromAwsManagedPolicyName(name)).concat([
      new iam.ManagedPolicy(this, 'Policy-cdk', {
        managedPolicyName: 'youtube_streaming_watcher_cdk',
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['apigateway:Get*'],
            resources: [apiArn]
          })
        ]
      })
    ])
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

    const iamRoleDeployPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'iam:AttachRolePolicy',
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:DeleteRolePolicy',
        'iam:DetachRolePolicy',
        'iam:PassRole',
        'iam:PutRolePolicy',
        'iam:CreatePolicyVersion',
        'iam:DeletePolicyVersion'
      ]
    })

    const cdkDeployRoleName = 'youtube_streaming_watcher_cdk_deploy'
    const iamRoleDeployPolicyResourceArns = [
      functionData.notify.role?.roleArn,
      functionData.reply.role?.roleArn,
      cdkDiffRole.roleArn,
      `arn:aws:iam::${this.account}:role/${cdkDeployRoleName}`,
      `arn:aws:iam::${this.account}:role/${id.slice(0, 24)}*`
    ]

    for (const arn of iamRoleDeployPolicyResourceArns) {
      if (arn !== undefined) {
        iamRoleDeployPolicy.addResources(arn)
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

    for (const tableProp of dynamoDBTableProps) {
      const table = new dynamodb.Table(this, `DynamoDBTable-${tableProp.tableName}`, Object.assign(tableProp, {
        removalPolicy: RemovalPolicy.RETAIN
      }))

      for (const func of functions) {
        table.grant(
          func,
          'dynamodb:DescribeTable',
          'dynamodb:PartiQLInsert',
          'dynamodb:PartiQLSelect',
          'dynamodb:PartiQLDelete',
          'dynamodb:PartiQLUpdate'
        )
        table.grant(
          cdkDeployRole,
          'dynamodb:CreateTable',
          'dynamodb:DeleteTable'
        )
      }
    }

    s3.Bucket.fromBucketName(this, 'Bucket-cdk_default', `cdk-${qualifier}-assets-${this.account}-${this.region}`).grantPut(cdkDeployRole)
    apiAccessLogGroup.grant(
      cdkDeployRole,
      'logs:CreateLogGroup',
      'logs:PutRetentionPolicy',
      'logs:DeleteLogGroup'
    )
    const cdkBootstrapParam = ssm.StringParameter.fromStringParameterName(this, 'SSMParameter-cdk_bootstrap', `/cdk-bootstrap/${qualifier}/version`)
    iam.Role.fromRoleName(this, 'Role-cdk_default_file_publishing_role', `cdk-${qualifier}-file-publishing-role-${this.account}-${this.region}`).grant(cdkDeployRole, 'sts:AssumeRole')
    const cdkDefaultRoles = ['lookup', 'deploy'].map(s => iam.Role.fromRoleName(this, `Role-cdk_default_${s}`, `cdk-${qualifier}-${s}-role-${this.account}-${this.region}`))

    for (const role of [cdkDiffRole, cdkDeployRole]) {
      cdkBootstrapParam.grantRead(role)
      for (const cdkDefaultRole of cdkDefaultRoles) {
        cdkDefaultRole.grant(role, 'sts:AssumeRole')
      }
    }

    for (const secret of Object.values(secrets)) {
      secret.grantRead(cdkDeployRole)
    }

    cdkDeployRole.addManagedPolicy(new iam.ManagedPolicy(this, 'Policy-cdk_deploy', {
      managedPolicyName: cdkDeployRoleName,
      statements: [
        iamRoleDeployPolicy,
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
            'apigateway:PATCH'
          ],
          resources: [apiArn]
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
          resources: functions.map(f => f.functionArn)
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'SNS:CreateTopic',
            'SNS:DeleteTopic'
          ],
          resources: [lambdaSNSTopic.topicArn]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'cloudwatch:PutMetricAlarm',
            'cloudwatch:DeleteAlarms'
          ],
          resources: alarmArns
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['chatbot:CreateSlackChannelConfiguration'],
          resources: [chatbotSlackChannelConfig.slackChannelConfigurationArn]
        })
      ]
    }))
  }
}
