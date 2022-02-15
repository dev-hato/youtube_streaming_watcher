import Parser from 'rss-parser'
import sleep from 'sleep-promise'
import { AttributeValue } from '@aws-sdk/client-dynamodb'
import { ChatPostMessageArguments } from '@slack/web-api'
import { google, youtube_v3 } from 'googleapis' // eslint-disable-line camelcase
import { runQuery } from '../common/dynamodb'
import { slackApp } from '../common/slack'

/** 通知状況 **/
enum NotifyMode { // eslint-disable-line no-unused-vars
    /** テーブル登録完了 **/
    Registered = 'Registered', // eslint-disable-line no-unused-vars
    /** 登録通知完了 **/
    NotifyRegistered = 'NotifyRegistered', // eslint-disable-line no-unused-vars
    /** リマインド通知 (配信開始1時間前) 完了 **/
    NotifyRemind = 'NotifyRemind' // eslint-disable-line no-unused-vars
}

// Youtube Data APIの1日あたりの上限ユニット数
const apiUnitLimitPerDay = 10000

export async function handler () {
  let currentNotificationAt: string | undefined
  const currentNotificationAtItems = await runQuery('SELECT next_notification_at FROM youtube_streaming_watcher_next_notification_times')

  if (currentNotificationAtItems.length > 0) {
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

  const channels = await runQuery('SELECT channel_id FROM youtube_streaming_watcher_channels')

  if (channels.length === 0) {
    return
  }

  try {
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

      const postedVideos: { [key: string]: { [key: string]: string | undefined } | undefined } = Object.fromEntries((await runQuery(
        'SELECT video_id, start_time, notify_mode FROM youtube_streaming_watcher_notified_videos WHERE channel_id=? AND video_id IN (' + feedItems.map(() => '?').join(', ') + ')',
        [{ S: channelId }].concat(feedItems.map(item => {
          return { S: item.videoId }
        }))
      )).map(item => {
        const data: (string | { [key: string]: string | undefined } | undefined)[] = [item.video_id.S]

        if (item.start_time?.S === undefined) {
          data.push(undefined)
        } else {
          data.push({
            startTime: item.start_time.S,
            notifyMode: item.notify_mode.S
          })
        }

        return data
      }))

      for (const feedItem of feedItems) {
        // 動画ID
        const videoId = feedItem.videoId

        const startTimeStr = postedVideos[videoId]?.startTime
        let startTime: Date | undefined

        if (startTimeStr !== undefined) {
          startTime = new Date(startTimeStr)
          const oneHourAgoTime = new Date(startTime)
          oneHourAgoTime.setHours(oneHourAgoTime.getHours() - 1)

          // 以下を全て満たしている場合はスキップ
          // * 登録通知が完了している
          // * 以下のいずれかを満たしている
          //   * 配信開始の1時間以上前
          //   * 配信開始まで1時間以内でリマインド通知が完了している
          if (new Date() < oneHourAgoTime || postedVideos[videoId]?.notifyMode === NotifyMode.NotifyRemind) {
            console.log(`skip: channel_id ${channelId}, video_id: ${videoId}`)
            continue
          }
        } else {
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
            console.log(`video data can not get: channel_id ${channelId}, video_id: ${videoId}`)
            continue
          }

          // 取得した配信開始時刻のうち、最も遅いものを配信開始時刻とする
          for (const videoItem of items) {
            const scheduledStartTimeStr = videoItem.liveStreamingDetails?.scheduledStartTime

            if (scheduledStartTimeStr === undefined || scheduledStartTimeStr === null) {
              continue
            }

            const scheduledStartTime = new Date(scheduledStartTimeStr)

            if (startTime === undefined || startTime < scheduledStartTime) {
              startTime = scheduledStartTime
            }
          }

          if (startTime === undefined) { // 配信開始時刻を取得できなかった場合はスキップ
            console.log(`start time can not get: channel_id ${channelId}, video_id: ${videoId}`)
            continue
          } else if (new Date(startTime) < new Date()) { // 既に配信開始している場合はスキップ
            console.log(`start time has passed: channel_id ${channelId}, video_id: ${videoId}, start_time: ${startTime}`)
            continue
          }

          const startTimeStr = startTime.toISOString()
          const notifyMode = NotifyMode.Registered
          postedVideos[videoId] = { startTime: startTimeStr, notifyMode }
          await runQuery(
            'INSERT INTO youtube_streaming_watcher_notified_videos VALUE {\'channel_id\': ?, \'video_id\': ?, \'created_at\': ?, \'start_time\': ?, \'notify_mode\': ?}',
            [{ S: channelId }, { S: videoId }, { S: (new Date()).toISOString() }, { S: startTimeStr }, { S: notifyMode }]
          )
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
              `開始時刻: ${startTime.getFullYear()}年${startTime.getMonth() + 1}月${startTime.getDate()}日 ` +
              `(${dayOfWeeks[startTime.getDay()]}) ` +
              `${startTime.getHours()}時${startTime.getMinutes()}分${startTime.getSeconds()}秒`
        }
        console.log('call app.client.chat.postMessage: ', postMessageParams)
        await slackApp.client.chat.postMessage(postMessageParams)
        const parameters: AttributeValue[] = []

        if (postedVideos[videoId]?.notifyMode === NotifyMode.Registered) {
          parameters.push({ S: NotifyMode.NotifyRegistered })
        } else {
          parameters.push({ S: NotifyMode.NotifyRemind })
        }

        await runQuery(
          'UPDATE youtube_streaming_watcher_notified_videos SET notify_mode=? WHERE channel_id=? AND video_id=?',
          parameters.concat([{ S: channelId }, { S: videoId }])
        )
      }

      await sleep(1000)
    }
  } finally {
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
}
