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

  try {
    const notifyVideoData: {
            [channelId: string]: {
                title?: string,
                videos: {
                    [videoId: string]: {
                        title?: string,
                        startTime?: Date,
                        updatedTime: Date,
                        notifyMode?: string,
                        isUpdated: boolean
                    }
                }
            }
        } = {}

    const channels = await runQuery('SELECT channel_id FROM youtube_streaming_watcher_channels')

    if (channels.length === 0) {
      console.log('registered channels are not found')
      return
    }

    // 新着配信一覧取得
    for (let { channel_id: { S: channelId } } of channels) {
      channelId = channelId as string
      const feedParser = new Parser<{}, { id: string, updated: string }>({ customFields: { item: ['id', 'updated'] } })
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
      console.log('get feed: ', feedUrl)
      const feed = await feedParser.parseURL(feedUrl)
      const videoIds = []
      const needGetStartTimeVideos: Set<string> = new Set()
      notifyVideoData[channelId] = { title: feed.title, videos: {} }

      for (const item of feed.items) {
        const videoId = item.id.replace(/^yt:video:/, '')
        notifyVideoData[channelId].videos[videoId] = {
          title: item.title,
          updatedTime: new Date(item.updated),
          isUpdated: false
        }
        videoIds.push(videoId)
        needGetStartTimeVideos.add(videoId)
      }

      // 登録済み配信取得
      const postedVideos = await runQuery(
        'SELECT video_id, start_time, updated_time, notify_mode FROM youtube_streaming_watcher_notified_videos ' +
                'WHERE channel_id=? AND video_id IN (' + videoIds.map(() => '?').join(', ') + ')',
        [{ S: channelId }].concat(videoIds.map(v => {
          return { S: v }
        }))
      )

      for (const item of postedVideos) {
        const videoId = item.video_id.S

        if (videoId === undefined) {
          console.log(`video_id can not get: channel_id ${channelId}, video_id: ${videoId}`)
          continue
        }

        const startTimeStr = item.start_time?.S
        const notifyMode = item.notify_mode?.S

        // 登録通知が完了している場合
        if (startTimeStr !== undefined) {
          const updateTime = item.updated_time?.S

          if (updateTime !== undefined && new Date(updateTime) < notifyVideoData[channelId].videos[videoId].updatedTime) {
            notifyVideoData[channelId].videos[videoId].isUpdated = true
          } else {
            needGetStartTimeVideos.delete(videoId)
          }

          const startTime = new Date(startTimeStr)
          const oneHourAgoTime = new Date(startTime)
          oneHourAgoTime.setHours(oneHourAgoTime.getHours() - 1)
          const now = new Date()

          // 以下のいずれかを満たしている場合は通知しない
          // * 配信開始の1時間以上前
          // * 既に配信開始済み
          // * 配信開始まで1時間以内でリマインド通知が完了している
          if (now < oneHourAgoTime || startTime < now || notifyMode === NotifyMode.NotifyRemind) {
            console.log(`skip: channel_id ${channelId}, video_id: ${videoId}`)
            delete notifyVideoData[channelId].videos[videoId]
            continue
          }

          notifyVideoData[channelId].videos[videoId].startTime = startTime
        }

        notifyVideoData[channelId].videos[videoId].notifyMode = notifyMode || ''
      }

      if (needGetStartTimeVideos.size === 0) {
        console.log(`videos that need get start time are not found: channel_id: ${channelId}`)
        continue
      }

      // 配信情報取得
      while (1) {
        await sleep(1000)

        const videoResultParams: youtube_v3.Params$Resource$Videos$List = { // eslint-disable-line camelcase
          part: ['liveStreamingDetails'],
          id: Array.from(needGetStartTimeVideos),
          maxResults: 50
        }
        console.log('call youtubeApi.videos.list: ', videoResultParams)
        const videoResult = await api.videos.list(videoResultParams)
        apiUnit++

        const items = videoResult.data.items

        if (items !== undefined) {
          for (const videoItem of items) {
            const videoId = videoItem.id

            if (videoId === undefined || videoId === null) {
              console.log('video data can not get')
              continue
            }

            let startTimeStr = videoItem.liveStreamingDetails?.scheduledStartTime

            if (startTimeStr === undefined || startTimeStr === null) {
              console.log(`start time can not get: channel_id ${channelId}, video_id: ${videoId}`)
              delete notifyVideoData[channelId].videos[videoId]
              continue
            }

            const startTime = new Date(startTimeStr)
            startTimeStr = startTime.toISOString()
            notifyVideoData[channelId].videos[videoId].startTime = startTime
            const oldNotifyMode = notifyVideoData[channelId].videos[videoId].notifyMode
            const notifyMode = NotifyMode.Registered
            notifyVideoData[channelId].videos[videoId].notifyMode = notifyMode
            const updatedTime = notifyVideoData[channelId].videos[videoId].updatedTime.toISOString()
            const now = new Date()

            if (oldNotifyMode === undefined) { // データがない場合はINSERTする
              await runQuery(
                'INSERT INTO youtube_streaming_watcher_notified_videos VALUE {\'channel_id\': ?, \'video_id\': ?, \'created_at\': ?, \'start_time\': ?, \'updated_time\': ?, \'notify_mode\': ?}',
                [{ S: channelId }, { S: videoId }, { S: now.toISOString() }, { S: startTimeStr }, { S: updatedTime }, { S: notifyMode }]
              )
            } else if (oldNotifyMode === '') { // start_timeやnotify_modeが欠けている古いデータについてはUPDATEする
              await runQuery(
                'UPDATE youtube_streaming_watcher_notified_videos SET start_time=? SET updated_time=? SET notify_mode=? WHERE channel_id=? AND video_id=?',
                [{ S: startTimeStr }, { S: updatedTime }, { S: notifyMode }, { S: channelId }, { S: videoId }]
              )
            }

            // 既に配信開始している場合は通知しない
            if (startTime < now) {
              console.log(`start time has passed: channel_id ${channelId}, video_id: ${videoId}, start_time: ${startTime}`)
              delete notifyVideoData[channelId].videos[videoId]
            }
          }
        }

        const nextPageToken = videoResult.data.nextPageToken

        if (nextPageToken === undefined || nextPageToken === null) {
          break
        }

        videoResultParams.pageToken = nextPageToken
      }
    }

    // 配信通知
    for (const [channelId, cd] of Object.entries(notifyVideoData)) {
      for (const [videoId, vd] of Object.entries(cd.videos)) {
        await sleep(1000)
        const dayOfWeeks = ['日', '月', '火', '水', '木', '金', '土']
        const parameters: AttributeValue[] = []
        let header = ''

        if (vd.notifyMode === NotifyMode.Registered) {
          parameters.push({ S: NotifyMode.NotifyRegistered })
          header = ':new: 新着\n'
        } else if (vd.isUpdated) {
          header = ':repeat: 配信情報更新\n'
        } else {
          parameters.push({ S: NotifyMode.NotifyRemind })
          header = ':bell: もうすぐ配信開始\n'
        }

        const startTime = vd.startTime

        if (startTime === undefined) {
          console.log(`startTime is undefined: channel_id ${channelId}, video_id ${videoId}`)
          continue
        }

        // Slack通知
        const postMessageParams: ChatPostMessageArguments = {
          channel: slackChannel,
          text:
              header +
              `チャンネル名: <https://www.youtube.com/channel/${channelId}|${cd.title}>\n` +
              `配信名: <https://www.youtube.com/watch?v=${videoId}|${vd.title}>\n` +
              `開始時刻: ${startTime.getFullYear()}年${startTime.getMonth() + 1}月${startTime.getDate()}日 ` +
              `(${dayOfWeeks[startTime.getDay()]}) ` +
              `${startTime.getHours()}時${startTime.getMinutes()}分${startTime.getSeconds()}秒`
        }
        console.log('call app.client.chat.postMessage: ', postMessageParams)
        await slackApp.client.chat.postMessage(postMessageParams)

        await runQuery(
          'UPDATE youtube_streaming_watcher_notified_videos SET notify_mode=? WHERE channel_id=? AND video_id=?',
          parameters.concat([{ S: channelId }, { S: videoId }])
        )
      }
    }
  } finally { // 次回実行時刻設定
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
