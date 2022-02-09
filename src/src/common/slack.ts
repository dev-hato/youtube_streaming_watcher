import { App, AppOptions, ExpressReceiver, GenericMessageEvent, SayFn } from '@slack/bolt'
import { runQuery } from './dynamodb'
import { RegisteredChannel } from '../reply/types'

if (process.env.SLACK_SIGNING_SECRET === undefined) {
  throw new Error('SLACK_SIGNING_SECRET must be set.')
}

const appOptions: AppOptions = {
  token: process.env.SLACK_BOT_TOKEN
}

export const expressReceiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: true
})

if (process.env.NODE_ENV === 'development') {
  appOptions.signingSecret = process.env.SLACK_SIGNING_SECRET
} else {
  appOptions.receiver = expressReceiver
}

export const slackApp = new App(appOptions)

async function postMessage (message: string, say: SayFn): Promise<void> {
  console.log('call say: ', message)
  await say(message)
}

async function getChannelData (
  message: GenericMessageEvent,
  say: SayFn
): Promise<RegisteredChannel | undefined> {
  const id = message.text?.split(' ')[2]
    .replace(/<https:\/\/www\.youtube\.com\/channel\//g, '')
    .replace(/>/g, '')

  if (id === undefined || id === '') {
    await postMessage(
      '引数としてチャンネルIDかチャンネルのURLを指定してください。',
      say
    )
    return
  }

  const registeredChannel = (await runQuery(
    'SELECT channel_id FROM youtube_streaming_watcher_channels WHERE channel_id=?',
    [{ S: id }]
  ))?.Items
  return {
    id,
    exist: registeredChannel !== undefined && registeredChannel.length > 0
  }
}

export function setMessageEvents () {
  slackApp.message('add', async ({ message, say }): Promise<void> => {
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

    await runQuery(
      'INSERT INTO youtube_streaming_watcher_channels VALUE {\'channel_id\': ?, \'created_at\': ?}',
      [{ S: channel.id }, { S: (new Date()).toISOString() }]
    )
    await postMessage(
            `このチャンネルを通知対象に追加しました: https://www.youtube.com/channel/${channel.id}`,
            say
    )
  })

  slackApp.message('delete', async ({ message, say }): Promise<void> => {
    const channel = await getChannelData(message = message as GenericMessageEvent, say)

    if (channel === undefined) {
      return
    } else if (!channel.exist) {
      await postMessage(
                `このチャンネルは通知対象ではありません: https://www.youtube.com/channel/${channel.id}`,
                say
      )
      return
    }

    await runQuery('DELETE FROM youtube_streaming_watcher_channels WHERE channel_id=?', [{ S: channel.id }])
    await postMessage(
            `このチャンネルを通知対象から削除しました: https://www.youtube.com/channel/${channel.id}`,
            say
    )
  })
}
