import serverlessExpress from '@vendia/serverless-express'
import { expressReceiver, setMessageEvents } from '../common/slack'

setMessageEvents()
export const handler = serverlessExpress({ app: expressReceiver.app })
