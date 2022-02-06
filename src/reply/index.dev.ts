import { AwsCallback, AwsEvent } from '@slack/bolt/dist/receivers/AwsLambdaReceiver'
import { createTables } from '../common/dynamodb'
import { slackApp } from '../common/slack'
import { callbackMock, contextMock, eventMock } from '../common/handler_arg_mock'
import { setMessageEvents } from './index'

export async function handler (event: AwsEvent, context: any, callback: AwsCallback) {
  await createTables()
  setMessageEvents()
  await slackApp.start()
}

(handler)(eventMock, contextMock, callbackMock)
