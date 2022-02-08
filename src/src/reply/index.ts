import { GenericMessageEvent, SayFn } from '@slack/bolt'
import { AwsCallback, AwsEvent } from '@slack/bolt/dist/receivers/AwsLambdaReceiver'
import { runQuery } from '../common/dynamodb'
import { awsLambdaReceiver, slackApp } from '../common/slack'
import { RegisteredChannel } from './types'

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

async function isAlreadyReceived (message: GenericMessageEvent, say: SayFn): Promise<boolean> {
  const messageChannel = message.channel
  const messageTs = message.ts
  const receivedMessages = await runQuery(
    'SELECT channel, ts FROM youtube_streaming_watcher_received_messages WHERE channel=? AND ts=?',
    [{ S: messageChannel }, { N: messageTs }]
  )

  if (receivedMessages?.Items !== undefined && receivedMessages.Items.length > 0) {
    console.log(`message is already received: channel ${messageChannel}, ts ${messageTs}`)
    return true
  }

  await say('処理中です。少々お待ちください :eyes:')
  await runQuery(
    'INSERT INTO youtube_streaming_watcher_received_messages VALUE {\'channel\': ?, \'ts\': ?}',
    [{ S: messageChannel }, { N: messageTs }]
  )
  return false
}

export function setMessageEvents () {
  slackApp.message('add', async ({ message, say }): Promise<void> => {
    message = message as GenericMessageEvent

    if (await isAlreadyReceived(message, say)) {
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
    message = message as GenericMessageEvent

    if (await isAlreadyReceived(message, say)) {
      return
    }

    const channel = await getChannelData(message, say)

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

async function handler (event: AwsEvent, context: any, callback: AwsCallback) {
  setMessageEvents()
  const handler = await awsLambdaReceiver.start()
  return handler(event, context, callback)
}

exports.handler = handler
