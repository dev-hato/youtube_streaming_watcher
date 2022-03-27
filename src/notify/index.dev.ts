import sleep from 'sleep-promise'
import { handler } from './index'
import { createTables } from '../common/dynamodb.dev'
import { rate } from '../../lib/props/events-rule-props'

async function devHandler (): Promise<void> {
  await createTables()

  while (true) {
    await handler()
    await sleep(rate.toMilliseconds())
  }
}

(devHandler)()
