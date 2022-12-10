#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { DefaultCdkStack } from '../lib/default/cdk-stack'
import { CEAnomalyCdkStack } from '../lib/cd-anomaly/cdk-stack'

const app = new App()
new DefaultCdkStack(app, 'Stack-youtube-streaming-watcher') // eslint-disable-line no-new
new CEAnomalyCdkStack(app, 'Stack-youtube-streaming-watcher-us-east-1', { env: { region: 'us-east-1' } }) // eslint-disable-line no-new
