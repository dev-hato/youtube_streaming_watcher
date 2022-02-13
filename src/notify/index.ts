import Parser from 'rss-parser'
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

    // RSSから新着配信取得
    const feedParser = new Parser<{}, { id: string }>({ customFields: { item: ['id'] } })
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    console.log('get feed: ', feedUrl)
    const feed = await feedParser.parseURL(feedUrl)
    const feedItems = feed.items.map(item => {
      return {
        videoId: item.id.replace(/^yt:video:/, ''),
        title: item.title
      }
    })

    const postedVideos = (await runQuery(
      'SELECT video_id FROM youtube_streaming_watcher_notified_videos WHERE channel_id=? AND video_id IN (' + feedItems.map(item => '?').join(', ') + ')',
      [{ S: channelId }].concat(feedItems.map(item => {
        return { S: item.videoId }
      }))
    ))?.Items?.map(item => item.video_id.S)

    for (const feedItem of feedItems) {
      // 動画ID
      const videoId = feedItem.videoId

      // 通知済みの配信の場合はスキップ
      if (postedVideos !== undefined && postedVideos.includes(videoId)) {
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
        console.log('video data can not get: ', videoId)
        continue
      }

      for (const videoItem of items) {
        const scheduledStartTime = videoItem.liveStreamingDetails?.scheduledStartTime

        if (scheduledStartTime === undefined || scheduledStartTime === null) {
          continue
        }

        const startTime = new Date(Date.parse(scheduledStartTime))

        if (startTime < new Date()) {
          continue
        }

        await sleep(1000)
        const dayOfWeeks = ['日', '月', '火', '水', '木', '金', '土']

        // Slack通知
        const postMessageParams: ChatPostMessageArguments = {
          channel: slackChannel,
          text:
              'チャンネル名: ' +
              feed.title +
              '\n' +
              '配信名: <https://www.youtube.com/watch?v=' +
              videoId +
              '|' +
              feedItem.title +
              '>\n' +
              `開始時刻: ${startTime.getFullYear()}年${startTime.getMonth()}月${startTime.getDate()}日 ` +
              `(${dayOfWeeks[startTime.getDay()]}) ` +
              `${startTime.getHours()}時${startTime.getMinutes()}分${startTime.getSeconds()}秒`
        }
        console.log('call app.client.chat.postMessage: ', postMessageParams)
        await slackApp.client.chat.postMessage(postMessageParams)
      }
    }

    await sleep(1000)
  }

  // APIリクエストの消費ユニット数 * 24時間 * 60分 * 60秒 / 1日あたりの上限ユニット数 + 1秒
  const sleepSeconds = Math.ceil((apiUnit * 24 * 60 * 60) / apiUnitLimitPerDay + 1)

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
