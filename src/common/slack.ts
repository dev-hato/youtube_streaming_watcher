import { App, AppOptions, ExpressReceiver, GenericMessageEvent, SayFn } from '@slack/bolt'
import axios from 'axios'
import cheerio from 'cheerio'
import Parser from 'rss-parser'
import { runQuery } from './dynamodb'
import { pingHandler, pingPath, port } from './server.dev'
import { getTwitterUserId } from './twitter'
import { getTwitterUserName } from './youtube'

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
  appOptions.port = port
  appOptions.signingSecret = process.env.SLACK_SIGNING_SECRET
  appOptions.customRoutes = [{ path: pingPath, method: ['GET'], handler: pingHandler }]
} else {
  appOptions.receiver = expressReceiver
}

export const slackApp = new App(appOptions)

async function postMessage (message: string, say: SayFn): Promise<void> {
  console.log('call say:', message)
  await say(message)
}

interface RegisteredChannel {
  id: string
  exist: boolean
}

async function isReceivedRequest (ts: string): Promise<boolean> {
  const receivedRequests = await runQuery(
    'SELECT ts FROM youtube_streaming_watcher_received_slack_requests WHERE ts=?',
    [{ S: ts }]
  )

  if (receivedRequests.length > 0) {
    console.log('request is already received:', ts)
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
  let id = message.text?.split(/[  ]/)[2] // eslint-disable-line no-irregular-whitespace
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
    console.log('get:', id)
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
  } else {
    try {
      const feedParser = new Parser()
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`
      console.log('get feed:', feedUrl)
      await feedParser.parseURL(feedUrl)
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'Status code 404') {
          await postMessage(
            'チャンネルIDが見つかりません',
            say
          )
          return
        } else if (e.message === 'Status code 500') {
          await postMessage(
            'チャンネルが存在するかの確認中にエラーが発生しました',
            say
          )
          return
        }
      }

      throw e
    }
  }

  const registeredChannel = await runQuery(
    'SELECT channel_id FROM youtube_streaming_watcher_channels WHERE channel_id=?',
    [{ S: id }]
  )
  return {
    id,
    exist: registeredChannel !== undefined && registeredChannel.length > 0
  }
}

export function setMessageEvents (): void {
  slackApp.message('list', async ({ message, say }): Promise<void> => {
    const isReceived = await isReceivedRequest(message.ts)

    if (!isReceived) {
      return
    }

    const channels = await runQuery('SELECT channel_id FROM youtube_streaming_watcher_channels')

    if (channels.length === 0) {
      await say('通知対象のチャンネルはありません')
      return
    }

    await say(
      '次のチャンネルを通知します\n' +
        channels
          .map(b => b.channel_id.S)
          .filter(b => b)
          .map(b => `* https://www.youtube.com/channel/${b ?? ''}`)
          .join('\n')
    )
  })

  slackApp.message('add', async ({ message, say }): Promise<void> => {
    const isReceived = await isReceivedRequest(message.ts)

    if (!isReceived) {
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

    let twitterId

    try {
      twitterId = await getTwitterUserId(await getTwitterUserName(channel.id))
    } catch (e) {
      console.log(e)
    }

    const createdAt = (new Date()).toISOString()

    if (twitterId === undefined) {
      await runQuery(
        'INSERT INTO youtube_streaming_watcher_channels VALUE {\'channel_id\': ?, \'created_at\': ?}',
        [{ S: channel.id }, { S: createdAt }]
      )
    } else {
      await runQuery(
        'INSERT INTO youtube_streaming_watcher_channels VALUE {\'channel_id\': ?, \'twitter_id\': ?, \'created_at\': ?}',
        [{ S: channel.id }, { S: twitterId }, { S: createdAt }]
      )
    }

    await postMessage(
            `このチャンネルを通知対象に追加しました: https://www.youtube.com/channel/${channel.id}`,
            say
    )
  })

  slackApp.message('delete', async ({ message, say }): Promise<void> => {
    const isReceived = await isReceivedRequest(message.ts)

    if (!isReceived) {
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

    await runQuery(
      'DELETE FROM youtube_streaming_watcher_channels WHERE channel_id=?',
      [{ S: channel.id }]
    )
    await postMessage(
            `このチャンネルを通知対象から削除しました: https://www.youtube.com/channel/${channel.id}`,
            say
    )
  })
}
