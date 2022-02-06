import { AwsEvent } from '@slack/bolt/dist/receivers/AwsLambdaReceiver'

export const eventMock: AwsEvent = {
  body: null,
  headers: undefined,
  multiValueHeaders: undefined,
  httpMethod: '',
  isBase64Encoded: false,
  path: '',
  pathParameters: undefined,
  queryStringParameters: undefined,
  multiValueQueryStringParameters: undefined,
  stageVariables: undefined,
  requestContext: undefined,
  resource: ''
}
export const contextMock = undefined

export function callbackMock (error?: Error | string | null, result?: any) {
  throw error
}
