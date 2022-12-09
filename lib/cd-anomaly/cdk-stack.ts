import { Construct } from 'constructs'
import { aws_ce as ce, aws_secretsmanager as secretmanager, Stack, StackProps } from 'aws-cdk-lib'
import { secretProps } from '../common/props/secret-props'

export class CEAnomalyCdkStack extends Stack {
  constructor (scope: Construct, id: string, props?: StackProps) {
    if (props?.env?.region !== 'us-east-1') {
      throw new Error('us-east-1へデプロイしてください')
    }

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
    const ceAnomalyMonitorName = 'cost'
    const ceAnomalyMonitor = new ce.CfnAnomalyMonitor(this, `CEAnomalyMonitor-${ceAnomalyMonitorName}`, {
      monitorName: ceAnomalyMonitorName,
      monitorType: 'DIMENSIONAL',
      monitorDimension: 'SERVICE'
    })
    const ceAnomalySubscriptionFrequency = 'DAILY'
    new ce.CfnAnomalySubscription(this, `CEAnomalySubscription-${ceAnomalySubscriptionFrequency.toLowerCase()}_${ceAnomalyMonitorName}`, { // eslint-disable-line no-new
      subscriptionName: ceAnomalyMonitorName,
      threshold: 7,
      frequency: ceAnomalySubscriptionFrequency,
      monitorArnList: [ceAnomalyMonitor.ref],
      subscribers: [{
        address: secrets.email.secretValueFromJson('email').toString(),
        type: 'EMAIL',
        status: 'CONFIRMED'
      }]
    })
  }
}
