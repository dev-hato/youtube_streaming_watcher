import sleep from 'sleep-promise'
import express from 'express'
import { handler } from './index'
import { createTables } from '../common/dynamodb.dev'
import { rate } from '../../lib/default/props/events-rule-props'
import { pingHandler, pingPath, port } from '../common/server.dev'

async function devHandler (): Promise<void> {
  await createTables()

  const pingApp = express()
  pingApp.listen(port)
  pingApp.get(pingPath, pingHandler)

  while (true) {
    await handler()
    await sleep(rate.toMilliseconds())
  }
}

devHandler().then(
  () => {
    // do nothing.
  },
  () => {
    // do nothing.
  }
)
