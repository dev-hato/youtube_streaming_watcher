import { startVideoNotify } from './youtube'
import { startSlack } from './slack'
import { postgresConnect, postgresDisconnect } from './db'

async function main (): Promise<void> {
  await postgresConnect()
  await startSlack()
  await startVideoNotify()
  await postgresDisconnect()
}

main()
