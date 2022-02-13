import { App, AppOptions, ExpressReceiver, GenericMessageEvent, SayFn } from '@slack/bolt'
import axios from 'axios'
import cheerio from 'cheerio'
import { runQuery } from './dynamodb'

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

interface RegisteredChannel {
  id: string;
  exist: boolean;
}

async function isReceivedRequest (ts: string): Promise<boolean> {
  const receivedRequests = (await runQuery(
    'SELECT ts FROM youtube_streaming_watcher_received_slack_requests WHERE ts=?',
    [{ S: ts }]
  ))?.Items

  if (receivedRequests !== undefined && receivedRequests.length > 0) {
    return false
  }

  await runQuery(
    'INSERT INTO youtube_streaming_watcher_received_slack_requests VALUE {\'ts\': ?}',
    [{ S: ts }]
  )
  return true
}

async function getChannelData (
  message: GenericMessageEvent,
  say: SayFn
): Promise<RegisteredChannel | undefined> {
  let id = message.text?.split(' ')[2]
    .replace(/</g, '')
    .replace(/>/g, '')
    .replace(/https:\/\/www\.youtube\.com\/channel\//g, '')

  if (id === undefined || id === '') {
    await postMessage(
      '引数としてチャンネルIDかチャンネルのURLを指定してください。',
      say
    )
    return
  }

  // チャンネルURLとしてユーザーIDを含むものやカスタムURLが与えられた場合は、ページをスクレイピングしチャンネルIDを取得
  if (id.startsWith('https://www.youtube.com/')) {
    console.log('get: ', id)
    const response = await axios.get(id)
    const $ = cheerio.load(response.data)
    const idContent = $('meta[itemprop="channelId"]').attr('content')

    if (idContent === undefined) {
      await postMessage(
        'チャンネルIDが取得できませんでした、正しいチャンネルのURLを指定してください',
        say
      )
      return
    }

    id = idContent
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
  slackApp.message('list', async ({ message, say }): Promise<void> => {
    const ts = message.ts
    const isReceived = await isReceivedRequest(ts)

    if (!isReceived) {
      console.log('request is already received: ', ts)
      return
    }

    const channels = (await runQuery('SELECT channel_id FROM youtube_streaming_watcher_channels'))?.Items

    if (channels === undefined || channels.length === 0) {
      await say('通知対象のチャンネルはありません')
      return
    }

    await say('以下のチャンネルを通知します\n' + channels.map(b => '* https://www.youtube.com/channel/' + b.channel_id.S).join('\n'))
  })

  slackApp.message('add', async ({ message, say }): Promise<void> => {
    const ts = message.ts
    const isReceived = await isReceivedRequest(ts)

    if (!isReceived) {
      console.log('request is already received: ', ts)
      return
    }

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
    const ts = message.ts
    const isReceived = await isReceivedRequest(ts)

    if (!isReceived) {
      console.log('request is already received: ', ts)
      return
    }

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
