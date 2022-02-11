import sleep from 'sleep-promise'
import { handler } from './index'
import { createTables } from '../common/dynamodb.dev'
import { rate } from '../../lib/events-rule-props'

async function devHandler () {
  await createTables()

  while (true) {
    await handler()
    await sleep(rate.toMilliseconds())
  }
}

(devHandler)()
