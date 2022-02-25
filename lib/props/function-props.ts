import { Duration, aws_lambda_nodejs as lambdaNode } from 'aws-cdk-lib'

export const functionProps: { [key: string]: lambdaNode.NodejsFunctionProps } = {
  notify: {
    functionName: 'youtube_streaming_watcher_notify_function',
    entry: 'src/notify/index.ts',
    timeout: Duration.minutes(5)
  },
  reply: {
    functionName: 'youtube_streaming_watcher_reply_function',
    entry: 'src/reply/index.ts',
    timeout: Duration.seconds(10)
  }
}
