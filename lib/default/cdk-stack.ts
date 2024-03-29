import { Construct } from 'constructs'
import {
  BOOTSTRAP_QUALIFIER_CONTEXT,
  DefaultStackSynthesizer,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_apigateway as apigateway,
  aws_budgets as budgets,
  aws_chatbot as chatbot,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNode,
  aws_logs as logs,
  aws_secretsmanager as secretmanager,
  aws_s3 as s3,
  aws_sns as sns,
  aws_ssm as ssm
} from 'aws-cdk-lib'
import * as fs from 'fs'
import { dynamoDBTableProps } from './props/dynamodb-table-props'
import { functionProps } from './props/function-props'
import { cdkRoleProps } from './props/cdk-role-props'
import { secretProps } from './props/secret-props'
import { budgetProps } from './props/budget-props'

export class DefaultCdkStack extends Stack {
  constructor (scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const secrets: { [secretName: string]: secretmanager.ISecret } = Object.fromEntries(secretProps.map(key => {
      const resourceName = key.replace(/[A-Z]/g, s => '_' + s.toLowerCase())
      return [
        key,
        secretmanager.Secret.fromSecretNameV2(
          this,
          `Secret-${resourceName}`,
          `youtube_streaming_watcher_${resourceName}`
        )
      ]
    }))

    for (const budget of budgetProps) {
      const timeUnit = 'MONTHLY'
      new budgets.CfnBudget(this, `BudgetsBudget-${timeUnit.toLowerCase()}_${budget.budgetName}`, { // eslint-disable-line no-new
        budget: {
          budgetLimit: { amount: budget.usdLimitAmount, unit: 'USD' },
          timeUnit,
          budgetName: budget.budgetName,
          costTypes: { includeRefund: false, includeCredit: false },
          budgetType: 'COST'
        },
        notificationsWithSubscribers: budget.notifications.map(notification => {
          return {
            notification,
            subscribers: [{
              address: secrets.email.secretValueFromJson('email').toString(),
              subscriptionType: 'EMAIL'
            }]
          }
        })
      })
    }

    const environment = {
      NODE_OPTIONS: '--unhandled-rejections=strict',
      SLACK_BOT_TOKEN: secrets.slack.secretValueFromJson('slack_bot_token').toString(),
      SLACK_CHANNEL: secrets.slack.secretValueFromJson('slack_channel').toString(),
      SLACK_SIGNING_SECRET: secrets.slack.secretValueFromJson('slack_signing_secret').toString(),
      TWITTER_BEARER_TOKEN: secrets.twitter.secretValueFromJson('twitter_bearer_token').toString(),
      TZ: 'Asia/Tokyo',
      YOUTUBE_API_KEY: secrets.youtube.secretValueFromJson('youtube_api_key').toString()
    }
    const functionDataEntities: Array<[string, lambdaNode.NodejsFunction]> = Object.entries(functionProps).map(
      ([key, value]) => {
        const runtime = lambda.Runtime.NODEJS_18_X
        const runtimeVersion = runtime.name.match('[0-9]+')

        if (runtimeVersion !== null && fs.readFileSync('.node-version').toString().match('^' + runtimeVersion[0]) === null) {
          throw Error(`Lambda関数 ${value.functionName ?? ''} のランタイムのバージョンが .node-version と一致していません。`)
        }

        return [
          key,
          new lambdaNode.NodejsFunction(this, `Function-${key}`, Object.assign(value, {
            runtime,
            bundling: { minify: true, sourceMap: true },
            environment
          }))
        ]
      }
    )
    const functionData = Object.fromEntries(functionDataEntities)
    const lambdaSNSTopic = new sns.Topic(this, 'SNSTopic-lambda')
    const lambdaSNSTopicAction = new cloudwatchActions.SnsAction(lambdaSNSTopic)
    const alarmArns = []

    for (const [key, func] of functionDataEntities) {
      const alarm = new cloudwatch.Alarm(this, `Alarm-lambda_${key}`, {
        evaluationPeriods: 1,
        metric: func.metric('Errors', {
          statistic: cloudwatch.Stats.AVERAGE,
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

    const chatbotSlackChannelConfig = new chatbot.SlackChannelConfiguration(
      this,
      'ChatbotSlackChannelConfig-default',
      {
        slackChannelConfigurationName: 'youtube_streaming_watcher_slack',
        slackWorkspaceId: secrets.slackAlert.secretValueFromJson('workspace_id').toString(),
        slackChannelId: secrets.slackAlert.secretValueFromJson('channel_id').toString(),
        notificationTopics: [lambdaSNSTopic]
      }
    )
    // const rule = new events.Rule(this, 'EventsRule-notify', {
    //   schedule: events.Schedule.rate(rate),
    //   targets: [new targets.LambdaFunction(functionData.notify)]
    // })
    const apiAccessLogGroup = new logs.LogGroup(this, 'Log-apigateway_reply', {
      logGroupName: '/aws/apigateway/youtube_streaming_watcher_reply_api/access_log',
      removalPolicy: RemovalPolicy.RETAIN
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

    const qualifier: string = this.node.tryGetContext(BOOTSTRAP_QUALIFIER_CONTEXT) ?? DefaultStackSynthesizer.DEFAULT_QUALIFIER
    const managedPolicies: iam.IManagedPolicy[] = [
      'AmazonDynamoDBReadOnlyAccess',
      'AmazonS3ReadOnlyAccess',
      'AmazonSNSReadOnlyAccess',
      'AWSCloudFormationReadOnlyAccess',
      'AmazonEventBridgeReadOnlyAccess',
      'AWSLambda_ReadOnlyAccess',
      'IAMReadOnlyAccess'
    ].map(name => iam.ManagedPolicy.fromAwsManagedPolicyName(name))

    const cdkRoleData = Object.fromEntries(cdkRoleProps.map(d => {
      const oidcSub = (process.env.REPOSITORY ?? 'dev-hato/youtube_streaming_watcher') + ':' + d.oidcSub
      return [
        d.name,
        new iam.Role(this, `Role-cdk_${d.name}`, {
          roleName: `youtube_streaming_watcher_cdk_${d.name}`,
          assumedBy: new iam.FederatedPrincipal(
            provider.openIdConnectProviderArn,
            {
              StringEquals: {
                'token.actions.githubusercontent.com:sub': 'repo:' + oidcSub,
                'token.actions.githubusercontent.com:aud': oidcAud
              }
            },
            'sts:AssumeRoleWithWebIdentity'
          ),
          managedPolicies
        })
      ]
    }))
    const apigatewayPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['apigateway:Get*'],
      resources: [`arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/*`]
    })
    const ceAnomalyPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ce:GetAnomaly*'],
      resources: ['*']
    })

    cdkRoleData.diff.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSBudgetsReadOnlyAccess'))
    cdkRoleData.diff.addManagedPolicy(new iam.ManagedPolicy(this, 'Policy-cdk_diff', {
      managedPolicyName: 'youtube_streaming_watcher_cdk_diff',
      statements: [
        apigatewayPolicyStatement,
        ceAnomalyPolicyStatement
      ]
    }))

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
      cdkRoleData.diff.roleArn,
      `arn:aws:iam::${this.account}:role/${cdkDeployRoleName}`,
      `arn:aws:iam::${this.account}:role/${id.slice(0, 24)}*`
    ]

    for (const arn of iamRoleDeployPolicyResourceArns) {
      if (arn !== undefined) {
        iamRoleDeployPolicy.addResources(arn)
      }
    }

    for (const tableProp of dynamoDBTableProps) {
      if (tableProp.tableName === undefined) {
        continue
      }

      const table = new dynamodb.Table(
        this,
          `DynamoDBTable-${tableProp.tableName}`,
          Object.assign(tableProp, { removalPolicy: RemovalPolicy.DESTROY })
      )

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
          cdkRoleData.deploy,
          'dynamodb:CreateTable',
          'dynamodb:DeleteTable'
        )
      }
    }

    const cdkRoles = Object.values(cdkRoleData)

    for (const region of [this.region, 'us-east-1']) {
      s3.Bucket.fromBucketName(
        this,
        `Bucket-cdk_default_${region}`,
        `cdk-${qualifier}-assets-${this.account}-${region}`
      ).grantPut(cdkRoleData.deploy)
      iam.Role.fromRoleName(
        this,
        `Role-cdk_default_file_publishing_role_${region}`,
        `cdk-${qualifier}-file-publishing-role-${this.account}-${region}`
      ).grant(cdkRoleData.deploy, 'sts:AssumeRole')

      for (const kind of ['lookup', 'deploy']) {
        const cdkDefaultRole = iam.Role.fromRoleName(
          this,
          `Role-cdk_default_${kind}_${region}`,
          `cdk-${qualifier}-${kind}-role-${this.account}-${region}`
        )

        for (const role of cdkRoles) {
          cdkDefaultRole.grant(role, 'sts:AssumeRole')
        }
      }
    }

    apiAccessLogGroup.grant(
      cdkRoleData.deploy,
      'logs:CreateLogGroup',
      'logs:PutRetentionPolicy',
      'logs:DeleteLogGroup'
    )
    const cdkBootstrapParam = ssm.StringParameter.fromStringParameterName(
      this,
      'SSMParameter-cdk_bootstrap',
        `/cdk-bootstrap/${qualifier}/version`
    )

    for (const role of cdkRoles) {
      cdkBootstrapParam.grantRead(role)
    }

    for (const secret of Object.values(secrets)) {
      secret.grantRead(cdkRoleData.deploy)
    }

    const apigatewayDeployPolicyStatement = apigatewayPolicyStatement.copy()
    apigatewayDeployPolicyStatement.addActions(
      'apigateway:DELETE',
      'apigateway:POST',
      'apigateway:PUT',
      'apigateway:PATCH'
    )
    const ceAnomalyDeployPolicyStatement = ceAnomalyPolicyStatement.copy()
    ceAnomalyDeployPolicyStatement.addActions('ce:UpdateAnomaly*', 'ce:DeleteAnomaly*', 'ce:CreateAnomaly*')
    cdkRoleData.deploy.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSBudgetsActionsWithAWSResourceControlAccess'))
    cdkRoleData.deploy.addManagedPolicy(new iam.ManagedPolicy(this, 'Policy-cdk_deploy', {
      managedPolicyName: cdkDeployRoleName,
      statements: [
        iamRoleDeployPolicy,
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['apigateway:PATCH'],
          resources: [`arn:aws:apigateway:${this.region}::/account`]
        }),
        apigatewayDeployPolicyStatement,
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
        // new iam.PolicyStatement({
        //   effect: iam.Effect.ALLOW,
        //   actions: [
        //     'events:RemoveTargets',
        //     'events:DeleteRule',
        //     'events:PutRule',
        //     'events:PutTargets'
        //   ],
        //   resources: [rule.ruleArn]
        // }),
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
        }),
        ceAnomalyDeployPolicyStatement
      ]
    }))
  }
}
