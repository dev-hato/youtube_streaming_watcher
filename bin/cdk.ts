#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { DefaultCdkStack } from '../lib/default/cdk-stack'

const app = new App()
new DefaultCdkStack(app, 'Stack-youtube-streaming-watcher') // eslint-disable-line no-new
