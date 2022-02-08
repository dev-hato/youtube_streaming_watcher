import sleep from 'sleep-promise'
import { createTables } from '../common/dynamodb.dev'
import { handler } from './index'

async function devHandler () {
  await createTables()

  while (true) {
    await handler()
    await sleep(60000)
  }
}

(devHandler)()
