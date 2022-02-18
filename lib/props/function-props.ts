import * as cdk from '@aws-cdk/core'
import { NodejsFunctionProps } from '@aws-cdk/aws-lambda-nodejs'

export const functionProps: { [key: string]: NodejsFunctionProps } = {
  notify: {
    functionName: 'youtube_streaming_watcher_notify_function',
    entry: 'src/notify/index.ts',
    timeout: cdk.Duration.minutes(5)
  },
  reply: {
    functionName: 'youtube_streaming_watcher_reply_function',
    entry: 'src/reply/index.ts',
    timeout: cdk.Duration.seconds(10)
  }
}
