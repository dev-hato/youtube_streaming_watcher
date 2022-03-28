import Parser from 'rss-parser'
import sleep from 'sleep-promise'
import { AttributeValue } from '@aws-sdk/client-dynamodb'
import { ChatPostMessageArguments } from '@slack/web-api'
import { google, youtube_v3 } from 'googleapis' // eslint-disable-line camelcase
import { runQuery } from '../common/dynamodb'
import { slackApp } from '../common/slack'

/** 通知状況 **/
enum NotifyMode {
  /** テーブル登録完了 **/
  Registered = 'Registered',
  /** 登録通知完了 **/
  NotifyRegistered = 'NotifyRegistered',
  /** リマインド通知 (配信開始1時間前) 完了 **/
  NotifyRemind = 'NotifyRemind'
}

/**
 * 配信のプライバシーステータス
 * https://developers.google.com/youtube/v3/docs/videos?hl=ja
 */
enum PrivacyStatus {
  /** 公開 **/
  Public = 'public',
  /** メンバーシップ限定・限界公開 **/
  Unlisted = 'unlisted',
  /** 非公開 **/
  Private = 'private'
}

// Youtube Data APIの1日あたりの上限ユニット数
const apiUnitLimitPerDay = 10000

const maxGetFeedRetryCnt = 10

export async function handler (): Promise<void> {
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
        title?: string
        videos: Map<string, {
          title?: string
          startTime?: Date
          updatedTime: Date
          notifyMode?: string
          needInsert: boolean
          isUpdated: boolean
          isLiveStreaming: boolean
          privacyStatus: string
        }>
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
      const feedParser = new Parser<Record<string, never>, { id: string, updated: string }>({ customFields: { item: ['id', 'updated'] } })
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
      let feed

      for (let i = 0; i < maxGetFeedRetryCnt; i++) {
        try {
          console.log('get feed:', feedUrl)
          feed = await feedParser.parseURL(feedUrl)
          break
        } catch (e) {
          if (i === maxGetFeedRetryCnt - 1) {
            throw e
          }

          console.error(e)
          await sleep(1000)
        }
      }

      if (feed === undefined) {
        console.log('feed is undefined')
        continue
      }

      const videoIds = []
      const needGetStartTimeVideos: Set<string> = new Set()
      notifyVideoData[channelId] = { title: feed.title, videos: new Map() }

      for (const item of feed.items) {
        const videoId = item.id.replace(/^yt:video:/, '')
        notifyVideoData[channelId].videos.set(videoId, {
          title: item.title,
          updatedTime: new Date(item.updated),
          needInsert: true,
          isUpdated: false,
          isLiveStreaming: true,
          privacyStatus: PrivacyStatus.Public
        })
        videoIds.push(videoId)
        needGetStartTimeVideos.add(videoId)
      }

      // 登録済み配信取得
      const postedVideos = await runQuery(
        'SELECT video_id, start_time, updated_time, notify_mode, privacy_status, is_live_streaming FROM youtube_streaming_watcher_notified_videos ' +
                'WHERE channel_id=? AND video_id IN (' + videoIds.map(() => '?').join(', ') + ')',
        [{ S: channelId }].concat(videoIds.map(v => {
          return { S: v }
        }))
      )

      for (const item of postedVideos) {
        const videoId = item.video_id.S

        if (videoId === undefined) {
          console.log(`video_id can not get: channel_id ${channelId}`)
          continue
        }

        const startTimeStr = item.start_time?.S
        const notifyMode = item.notify_mode?.S
        const video = notifyVideoData[channelId].videos.get(videoId)

        // 登録通知が完了している場合
        if (startTimeStr !== undefined) {
          const startTime = new Date(startTimeStr)
          const oneHourAgoTime = new Date(startTime)
          oneHourAgoTime.setHours(oneHourAgoTime.getHours() - 1)
          const updateTime = item.updated_time?.S
          const now = new Date()

          // 以下のいずれかを満たしている場合は通知しない
          // * 配信開始の1時間以上前
          // * 既に配信開始済み
          // * 配信開始まで1時間以内でリマインド通知が完了している
          if (now < oneHourAgoTime || startTime < now || notifyMode === NotifyMode.NotifyRemind) {
            console.log(`skip: channel_id ${channelId}, video_id: ${videoId}`)
            needGetStartTimeVideos.delete(videoId)
            notifyVideoData[channelId].videos.delete(videoId)
            continue
          } else if (updateTime !== undefined && video !== undefined && new Date(updateTime) < video.updatedTime) {
            video.isUpdated = true
          } else {
            needGetStartTimeVideos.delete(videoId)
          }

          if (video !== undefined) {
            video.startTime = startTime
          }
        }

        if (video === undefined) {
          continue
        }

        video.notifyMode = notifyMode ?? ''
        video.needInsert = false
        video.privacyStatus = item.privacy_status?.S ?? PrivacyStatus.Public
        video.isLiveStreaming = item.is_live_streaming?.BOOL ?? true
      }

      if (needGetStartTimeVideos.size === 0) {
        console.log(`videos that need get start time are not found: channel_id: ${channelId}`)
        continue
      }

      const needGetStartTimeVideoList = Array.from(needGetStartTimeVideos)

      // 配信情報取得
      while (true) {
        await sleep(1000)

        const videoResultParams: youtube_v3.Params$Resource$Videos$List = { // eslint-disable-line camelcase
          part: ['liveStreamingDetails', 'snippet', 'status'],
          id: needGetStartTimeVideoList,
          maxResults: 50
        }
        console.log('call youtubeApi.videos.list:', videoResultParams)
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

            needGetStartTimeVideos.delete(videoId)
            const video = notifyVideoData[channelId].videos.get(videoId)
            let startTimeStr = videoItem.liveStreamingDetails?.scheduledStartTime

            if (startTimeStr === undefined || startTimeStr === null) {
              const publishedAt = videoItem.snippet?.publishedAt
              if (publishedAt !== undefined && publishedAt !== null) {
                startTimeStr = publishedAt
                if (video !== undefined) {
                  video.isLiveStreaming = false
                }
              } else {
                console.log(`start time can not get: channel_id ${channelId}, video_id: ${videoId}`)
                notifyVideoData[channelId].videos.delete(videoId)
                continue
              }
            }

            const startTime = new Date(startTimeStr)
            startTimeStr = startTime.toISOString()

            if (video === undefined) {
              continue
            }

            video.startTime = startTime
            let notifyMode = video.notifyMode

            if (notifyMode === undefined || notifyMode === '') {
              notifyMode = NotifyMode.Registered
            }

            video.notifyMode = notifyMode
            const privacyStatus = videoItem.status?.privacyStatus

            if (privacyStatus !== undefined && privacyStatus !== null) {
              video.privacyStatus = privacyStatus
            }

            const updatedTime = video.updatedTime.toISOString()
            const now = new Date()
            const yesterday = new Date(now.getTime())
            yesterday.setDate(now.getDate() - 1)

            if (video.needInsert) { // データがない場合はINSERTする
              await runQuery(
                'INSERT INTO youtube_streaming_watcher_notified_videos VALUE {\'channel_id\': ?, \'video_id\': ?, \'created_at\': ?, \'start_time\': ?, \'updated_time\': ?, \'notify_mode\': ?, \'privacy_status\': ?, \'is_live_streaming\': ?}',
                [{ S: channelId }, { S: videoId }, { S: now.toISOString() }, { S: startTimeStr }, { S: updatedTime }, { S: notifyMode }, { S: video.privacyStatus }, { BOOL: video.isLiveStreaming }]
              )
            } else {
              await runQuery(
                'UPDATE youtube_streaming_watcher_notified_videos SET start_time=? SET updated_time=? SET notify_mode=? SET privacy_status=? SET is_live_streaming=? WHERE channel_id=? AND video_id=?',
                [{ S: startTimeStr }, { S: updatedTime }, { S: notifyMode }, { S: video.privacyStatus }, { BOOL: video.isLiveStreaming }, { S: channelId }, { S: videoId }]
              )
            }

            // 既に配信開始している、もしくは、動画投稿から1日以上経っている場合は通知しない
            if ((video.isLiveStreaming && startTime < now) || (!video.isLiveStreaming && startTime < yesterday)) {
              console.log(`start time has passed: channel_id ${channelId}, video_id: ${videoId}, start_time: ${startTime.toISOString()}`)
              notifyVideoData[channelId].videos.delete(videoId)
            }
          }
        }

        const nextPageToken = videoResult.data.nextPageToken

        if (nextPageToken === undefined || nextPageToken === null) {
          break
        }

        videoResultParams.pageToken = nextPageToken
      }

      for (const videoId of needGetStartTimeVideos) {
        const title = notifyVideoData[channelId].title
        let text = ':x: 配信削除\n'

        if (title !== undefined) {
          text += `チャンネル名: <https://www.youtube.com/channel/${channelId}|${title}>\n`
        }

        text += `配信URL: <https://www.youtube.com/watch?v=${videoId}>`

        // Slack通知
        const postMessageParams: ChatPostMessageArguments = {
          channel: slackChannel,
          text
        }
        console.log('call app.client.chat.postMessage:', postMessageParams)
        await slackApp.client.chat.postMessage(postMessageParams)
        await runQuery(
          'DELETE FROM youtube_streaming_watcher_notified_videos WHERE channel_id=? AND video_id=?',
          [{ S: channelId }, { S: videoId }]
        )
      }
    }

    // 配信通知
    for (const [channelId, cd] of Object.entries(notifyVideoData)) {
      for (const [videoId, vd] of cd.videos) {
        await sleep(1000)
        const dayOfWeeks = ['日', '月', '火', '水', '木', '金', '土']
        const parameters: AttributeValue[] = []
        let text = ''

        if (vd.notifyMode === NotifyMode.Registered) {
          parameters.push({ S: NotifyMode.NotifyRegistered })
          text = ':new: 新着'
          if (vd.isLiveStreaming) {
            text += '配信'
          } else {
            text += '動画'
          }
        } else if (vd.isUpdated) {
          text = ':repeat: '

          if (vd.isLiveStreaming) {
            text += '配信'
          } else {
            text += '動画'
          }

          text += '情報更新'
        } else {
          parameters.push({ S: NotifyMode.NotifyRemind })
          text = ':bell: もうすぐ'
          if (vd.isLiveStreaming) {
            text += '配信開始'
          } else {
            text += '公開'
          }
        }

        if (vd.privacyStatus === PrivacyStatus.Unlisted) {
          text += ' (メンバーシップ限定・限定公開)'
        }

        const startTime = vd.startTime

        if (startTime === undefined) {
          console.log(`startTime is undefined: channel_id ${channelId}, video_id ${videoId}`)
          continue
        }

        text += '\n'

        if (cd.title !== undefined) {
          text += `チャンネル名: <https://www.youtube.com/channel/${channelId}|${cd.title}>\n`
        }

        if (vd.title !== undefined) {
          text += `配信名: <https://www.youtube.com/watch?v=${videoId}|${vd.title}>\n`
        }

        text += `開始時刻: ${startTime.getFullYear()}年${startTime.getMonth() + 1}月${startTime.getDate()}日 ` +
            `(${dayOfWeeks[startTime.getDay()]}) ` +
            `${startTime.getHours()}時${startTime.getMinutes()}分${startTime.getSeconds()}秒`

        // Slack通知
        const postMessageParams: ChatPostMessageArguments = {
          channel: slackChannel,
          text
        }
        console.log('call app.client.chat.postMessage:', postMessageParams)
        await slackApp.client.chat.postMessage(postMessageParams)

        if (parameters.length === 0) {
          continue
        }

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
