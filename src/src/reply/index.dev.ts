import { createTables } from '../common/dynamodb.dev'
import { slackApp } from '../common/slack'
import { setMessageEvents } from './index'

async function devHandler () {
  await createTables()
  setMessageEvents()
  await slackApp.start()
}

(devHandler)()
