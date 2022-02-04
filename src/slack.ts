import { App, GenericMessageEvent, SayFn } from '@slack/bolt'
import { postgresClient } from './db'

interface RegisteredChannel {
  id: string
  exist: boolean
}

async function postMessage (message: string, say: SayFn): Promise<void> {
  console.log('call say: ', message)
  await say(message)
}

async function getChannelData (
  message: GenericMessageEvent,
  say: SayFn
): Promise<RegisteredChannel | void> {
  const id = message.text
    ?.split(' ')[2]
    .replace('<https://www.youtube.com/channel/', '')
    .replace('>', '')

  if (id === undefined || id === '') {
    await postMessage(
      '引数としてチャンネルIDかチャンネルのURLを指定してください。',
      say
    )
    return
  }

  const registeredChannel = await postgresClient.query(
    'SELECT channel_id FROM channels WHERE channel_id=$1',
    [id]
  )
  return {
    id,
    exist: registeredChannel.rowCount > 0
  }
}

export const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
})

export async function startSlack (): Promise<void> {
  slackApp.message('add', async ({ message, say }) => {
    await postgresClient.query('BEGIN')
    const channel = await getChannelData(message as GenericMessageEvent, say)

    if (channel === undefined) {
      return
    } else if (channel.exist) {
      await postMessage(
        `このチャンネルは既に通知対象に追加されています: https://www.youtube.com/channel/${channel.id}`,
        say
      )
      return
    }

    await postgresClient.query(
      'INSERT INTO channels(channel_id, created_at) VALUES($1, $2)',
      [channel.id, new Date()]
    )
    await postgresClient.query('COMMIT')
    await postMessage(
      `このチャンネルを通知対象に追加しました: https://www.youtube.com/channel/${channel.id}`,
      say
    )
  })

  slackApp.message('delete', async ({ message, say }) => {
    await postgresClient.query('BEGIN')
    const channel = await getChannelData(message as GenericMessageEvent, say)

    if (channel === undefined) {
      return
    } else if (!channel.exist) {
      await postMessage(
        `このチャンネルは通知対象ではありません: https://www.youtube.com/channel/${channel.id}`,
        say
      )
      return
    }

    await postgresClient.query('DELETE FROM channels WHERE channel_id=$1', [
      channel.id
    ])
    await postgresClient.query('COMMIT')
    await postMessage(
      `このチャンネルを通知対象から削除しました: https://www.youtube.com/channel/${channel.id}`,
      say
    )
  })

  await slackApp.start()
  console.log('⚡️ Bolt app is running!')
}
