import sleep from 'sleep-promise'
import { ChatPostMessageArguments } from '@slack/web-api'
import { google, youtube_v3 } from 'googleapis' // eslint-disable-line camelcase
import { runQuery } from '../common/dynamodb'
import { slackApp } from '../common/slack'

// Youtube Data APIの1日あたりの上限ユニット数
const apiUnitLimitPerDay = 10000

export async function handler () {
  let currentNotificationAt: string | undefined
  const currentNotificationAtItems = (await runQuery('SELECT next_notification_at FROM youtube_streaming_watcher_next_notification_times'))?.Items

  if (currentNotificationAtItems !== undefined && currentNotificationAtItems.length > 0) {
    currentNotificationAt = currentNotificationAtItems[0].next_notification_at.S
    if (currentNotificationAt !== undefined && new Date() < new Date(currentNotificationAt)) {
      console.log('next notification time has not come yet.')
      return
    }
  }

  if (process.env.SLACK_CHANNEL === undefined) {
    throw new Error('SLACK_CHANNEL must be set.')
  }

  const slackChannel = process.env.SLACK_CHANNEL
  const api = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
  })

  // Youtube Data APIの消費ユニット数
  // APIごとの消費コスト: https://developers.google.com/youtube/v3/determine_quota_cost
  let apiUnit = 0

  const channels = (await runQuery('SELECT channel_id FROM youtube_streaming_watcher_channels'))?.Items

  if (channels === undefined) {
    return
  }

  for (let { channel_id: { S: channelId } } of channels) {
    channelId = channelId as string

    // チャンネルの配信一覧
    const searchListParams = {
      part: ['snippet'],
      eventType: 'upcoming',
      type: ['video'],
      channelId
    }
    console.log('call youtubeApi.search.list: ', searchListParams)
    const searchList = await api.search.list(searchListParams)
    apiUnit += 100

    if (searchList.data.items) {
      for (const searchItem of searchList.data.items) {
        // 動画ID
        const videoId = searchItem.id?.videoId

        const snippet = searchItem.snippet

        if (videoId === undefined || videoId === null || snippet === undefined) {
          continue
        }

        const postedVideos = (await runQuery(
          'SELECT video_id FROM youtube_streaming_watcher_notified_videos WHERE channel_id=? AND video_id=?',
          [{ S: channelId }, { S: videoId }]
        ))?.Items

        // 通知済みの配信の場合はスキップ
        if (postedVideos !== undefined && postedVideos.length > 0) {
          console.log(`skip: channel_id ${channelId}, video_id: ${videoId}`)
          continue
        }

        await runQuery(
          'INSERT INTO youtube_streaming_watcher_notified_videos VALUE {\'channel_id\': ?, \'video_id\': ?, \'created_at\': ?}',
          [{ S: channelId }, { S: videoId }, { S: (new Date()).toISOString() }]
        )

        await sleep(1000)

        // 配信情報
        const videoResultParams: youtube_v3.Params$Resource$Videos$List = { // eslint-disable-line camelcase
          part: ['liveStreamingDetails'],
          id: [videoId]
        }
        console.log('call youtubeApi.videos.list: ', videoResultParams)
        const videoResult = await api.videos.list(videoResultParams)
        apiUnit++
        const items = videoResult.data.items

        if (items === undefined) {
          continue
        }

        for (const videoItem of items) {
          const scheduledStartTime = videoItem.liveStreamingDetails?.scheduledStartTime

          if (scheduledStartTime === undefined || scheduledStartTime === null) {
            continue
          }

          await sleep(1000)
          const startTime = new Date(Date.parse(scheduledStartTime))
          const dayOfWeeks = ['日', '月', '火', '水', '木', '金', '土']

          // Slack通知
          const postMessageParams: ChatPostMessageArguments = {
            channel: slackChannel,
            text:
              'チャンネル名: ' +
              snippet.channelTitle +
              '\n' +
              '配信名: <https://www.youtube.com/watch?v=' +
              videoId +
              '|' +
              snippet.title +
              '>\n' +
              `開始時刻: ${startTime.getFullYear()}年${startTime.getMonth()}月${startTime.getDate()}日 ` +
              `(${dayOfWeeks[startTime.getDay()]}) ` +
              `${startTime.getHours()}時${startTime.getMinutes()}分${startTime.getSeconds()}秒`
          }
          console.log('call app.client.chat.postMessage: ', postMessageParams)
          await slackApp.client.chat.postMessage(postMessageParams)
        }
      }
    }

    await sleep(1000)
  }

  // APIリクエストの消費ユニット数 * 24時間 * 60分 * 60秒 / (2 * 1日あたりの上限ユニット数) + 1秒
  const sleepSeconds = Math.ceil((apiUnit * 24 * 60 * 60) / (2 * apiUnitLimitPerDay) + 1)

  if (currentNotificationAt !== undefined) {
    await runQuery(
      'DELETE FROM youtube_streaming_watcher_next_notification_times WHERE next_notification_at=?',
      [{ S: currentNotificationAt }]
    )
  }

  const nextNotificationAt = new Date()
  nextNotificationAt.setSeconds(nextNotificationAt.getSeconds() + sleepSeconds)
  await runQuery(
    'INSERT INTO youtube_streaming_watcher_next_notification_times VALUE {\'next_notification_at\': ?}',
    [{ S: nextNotificationAt.toISOString() }]
  )
  console.log('next notify at ', nextNotificationAt)
}
