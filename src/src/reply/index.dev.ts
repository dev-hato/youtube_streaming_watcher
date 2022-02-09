import { createTables } from '../common/dynamodb.dev'
import { setMessageEvents, slackApp } from '../common/slack'

async function devHandler () {
  await createTables()
  setMessageEvents()
  await slackApp.start()
}

(devHandler)()
