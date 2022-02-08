import { App, AppOptions, AwsLambdaReceiver } from '@slack/bolt'

if (process.env.SLACK_SIGNING_SECRET === undefined) {
  throw new Error('SLACK_SIGNING_SECRET must be set.')
}

const appOptions: AppOptions = {
  token: process.env.SLACK_BOT_TOKEN,
  processBeforeResponse: true
}

export const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET
})

if (process.env.NODE_ENV === 'development') {
  appOptions.signingSecret = process.env.SLACK_SIGNING_SECRET
} else {
  appOptions.receiver = awsLambdaReceiver
}

export const slackApp = new App(appOptions)
