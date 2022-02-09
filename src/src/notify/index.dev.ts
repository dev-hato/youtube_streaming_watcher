import sleep from 'sleep-promise'
import { handler } from './index'
import { createTables } from '../common/dynamodb.dev'
import { eventRuleRateMilliSeconds } from '../../config/config.json'

async function devHandler () {
  await createTables()

  while (true) {
    await handler()
    await sleep(eventRuleRateMilliSeconds)
  }
}

(devHandler)()
