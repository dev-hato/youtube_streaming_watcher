import axios from 'axios'
import Parser from 'rss-parser'
import sleep from 'sleep-promise'
import { AttributeValue } from '@aws-sdk/client-dynamodb'
import { ChatPostMessageArguments } from '@slack/web-api'
import { google, youtube_v3 } from 'googleapis' // eslint-disable-line camelcase
import { runQuery } from '../common/dynamodb'
import { slackApp } from '../common/slack'
import { twitterApiReadOnly } from '../common/twitter'

/** 通知状況 **/
enum NotifyMode { // eslint-disable-line no-unused-vars
    /** テーブル登録完了 **/
    Registered = 'Registered', // eslint-disable-line no-unused-vars
    /** 登録通知完了 **/
    NotifyRegistered = 'NotifyRegistered', // eslint-disable-line no-unused-vars
    /** リマインド通知 (配信開始1時間前) 完了 **/
    NotifyRemind = 'NotifyRemind' // eslint-disable-line no-unused-vars
}

/**
 * 配信のプライバシーステータス
 * https://developers.google.com/youtube/v3/docs/videos?hl=ja
 */
enum PrivacyStatus { // eslint-disable-line no-unused-vars
    /** 公開 **/
    Public = 'public', // eslint-disable-line no-unused-vars
    /** メンバーシップ限定・限界公開 **/
    Unlisted = 'unlisted', // eslint-disable-line no-unused-vars
    /** 非公開 **/
    Private = 'private' // eslint-disable-line no-unused-vars
}

// Youtube Data APIの1日あたりの上限ユニット数
const apiUnitLimitPerDay = 10000

const maxGetFeedRetryCnt = 10

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
            /** チャンネルID
             * 通常は配信のチャンネルIDが入る
             * コラボ配信の場合は配信をツイートした配信者のチャンネルIDが入る
             *  **/
            [channelId: string]: {
                title?: string,
                videos: {
                    [videoId: string]: {
                        videoTitle?: string,
                        startTime?: Date,
                        updatedTime: Date,
                        notifyMode?: string,
                        needInsert: boolean,
                        isUpdated: boolean,
                        isLiveStreaming: boolean,
                        privacyStatus: string,
                        /** コラボ配信か **/
                        isCollab: boolean,
                        /** 配信のチャンネルID (コラボ配信の場合のみ入る) **/
                        collabChannelId?: string,
                        /** 配信のチャンネルタイトル (コラボ配信の場合のみ入る) **/
                        collabChannelTitle?: string,
                    }
                }
            }
        } = {}

    const channels = await runQuery('SELECT channel_id, twitter_id FROM youtube_streaming_watcher_channels')

    if (channels.length === 0) {
      console.log('registered channels are not found')
      return
    }

    const videoIds = new Set()
    const videoIdsPerChannels: { [channelId: string]: Array<string> } = {}
    const needGetStartTimeVideos: { [channelId: string]: Set<string> } = {}

    // 新着配信一覧取得
    for (const { channel_id: { S: channelId } } of channels) {
      if (channelId === undefined) {
        continue
      }

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

      videoIdsPerChannels[channelId] = []
      needGetStartTimeVideos[channelId] = new Set()
      notifyVideoData[channelId] = { title: feed.title, videos: {} }

      for (const item of feed.items) {
        const videoId = item.id.replace(/^yt:video:/, '')
        notifyVideoData[channelId].videos[videoId] = {
          videoTitle: item.title,
          updatedTime: new Date(item.updated),
          needInsert: true,
          isUpdated: false,
          isLiveStreaming: true,
          privacyStatus: PrivacyStatus.Public,
          isCollab: false
        }
        videoIds.add(videoId)
        videoIdsPerChannels[channelId].push(videoId)
        needGetStartTimeVideos[channelId].add(videoId)
      }
    }

    for (const { channel_id: { S: channelId }, twitter_id: { S: twitterId } } of channels) {
      if (channelId === undefined) {
        continue
      }

      if (twitterId !== undefined) {
        await sleep(1000)
        console.log('get twitter user timeline:', twitterId)
        const timeLine = await twitterApiReadOnly.v2.userTimeline(twitterId, { max_results: 30 })
        const tweetStack = timeLine.tweets
        const getTweetMaxCount = tweetStack.length * 2
        const tweets: Array<{ url: string, createdAt: string | undefined }> = []

        for (let i = 0; i < getTweetMaxCount && tweetStack.length > 0; i++) {
          const tweet = tweetStack.pop()

          if (tweet === undefined) {
            continue
          }

          for (const shortUrl of tweet.text.matchAll(/https:\/\/t\.co\/[a-zA-Z0-9]+/g)) {
            await sleep(1000)
            const tweetUrl = shortUrl[0]
            let url

            try {
              console.log('get:', tweetUrl)
              const response = await axios.get(tweetUrl)
              url = response.request.res.responseUrl
            } catch (e) {
              console.log(e)
              continue
            }
            const twitterIdPattern = url.match(/https:\/\/twitter\.com\/[^/]+\/status\/([^/]+)/)

            if (twitterIdPattern === null || twitterIdPattern.length < 2) {
              tweets.push({ url, createdAt: tweet.created_at })
              continue
            }

            const tweetId = twitterIdPattern[1]

            if (tweet.id === tweetId) {
              continue
            }

            await sleep(1000)
            console.log('get tweet:', tweetId)
            const tweetsResult = await twitterApiReadOnly.v2.tweets(tweetId)
            tweetStack.push(tweetsResult.data[0])
          }
        }

        for (const { url, createdAt } of tweets) {
          const videoIdsPattern = url.match(/https:\/\/www\.youtube\.com\/watch\?v=([^&]+)/)

          if (videoIdsPattern === null || videoIdsPattern.length < 2) {
            continue
          }

          const videoId = videoIdsPattern[1]

          if (videoId.length > 11) {
            console.log('video id maybe invalid:', videoId)
            continue
          }

          if (videoIds.has(videoId)) {
            continue
          }

          let updatedTime = new Date()

          if (createdAt) {
            updatedTime = new Date(createdAt)
          }

          notifyVideoData[channelId].videos[videoId] = {
            updatedTime,
            needInsert: true,
            isUpdated: false,
            isLiveStreaming: true,
            privacyStatus: PrivacyStatus.Public,
            isCollab: true
          }
          videoIds.add(videoId)
          videoIdsPerChannels[channelId].push(videoId)
          needGetStartTimeVideos[channelId].add(videoId)
        }
      }

      // 登録済み配信取得
      const postedVideos = await runQuery(
        'SELECT video_id, start_time, updated_time, notify_mode, privacy_status, is_live_streaming FROM youtube_streaming_watcher_notified_videos ' +
                'WHERE channel_id=? AND video_id IN (' + videoIdsPerChannels[channelId].map(() => '?').join(', ') + ')',
        [{ S: channelId }].concat(videoIdsPerChannels[channelId].map(v => {
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
            needGetStartTimeVideos[channelId].delete(videoId)
            delete notifyVideoData[channelId].videos[videoId]
            continue
          } else if (updateTime !== undefined && new Date(updateTime) < notifyVideoData[channelId].videos[videoId].updatedTime) {
            notifyVideoData[channelId].videos[videoId].isUpdated = true
          } else {
            needGetStartTimeVideos[channelId].delete(videoId)
          }

          notifyVideoData[channelId].videos[videoId].startTime = startTime
        }

        notifyVideoData[channelId].videos[videoId].notifyMode = notifyMode || ''
        notifyVideoData[channelId].videos[videoId].needInsert = false
        notifyVideoData[channelId].videos[videoId].privacyStatus = item.privacy_status?.S || PrivacyStatus.Public
        notifyVideoData[channelId].videos[videoId].isLiveStreaming = item.is_live_streaming?.BOOL || true
      }

      if (needGetStartTimeVideos[channelId].size === 0) {
        console.log(`videos that need get start time are not found: channel_id: ${channelId}`)
        continue
      }

      const needGetStartTimeVideoList = Array.from(needGetStartTimeVideos[channelId])

      // 配信情報取得
      while (1) {
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

            needGetStartTimeVideos[channelId].delete(videoId)
            let startTimeStr = videoItem.liveStreamingDetails?.scheduledStartTime

            if (startTimeStr === undefined || startTimeStr === null) {
              const publishedAt = videoItem.snippet?.publishedAt
              if (publishedAt !== undefined && publishedAt !== null) {
                startTimeStr = publishedAt
                notifyVideoData[channelId].videos[videoId].isLiveStreaming = false
              } else {
                console.log(`start time can not get: channel_id ${channelId}, video_id: ${videoId}`)
                delete notifyVideoData[channelId].videos[videoId]
                continue
              }
            }

            const startTime = new Date(startTimeStr)
            startTimeStr = startTime.toISOString()
            notifyVideoData[channelId].videos[videoId].startTime = startTime
            let notifyMode = notifyVideoData[channelId].videos[videoId].notifyMode

            if (notifyMode === undefined || notifyMode === '') {
              notifyMode = NotifyMode.Registered
            }

            notifyVideoData[channelId].videos[videoId].notifyMode = notifyMode
            const privacyStatus = videoItem.status?.privacyStatus

            if (privacyStatus !== undefined && privacyStatus !== null) {
              notifyVideoData[channelId].videos[videoId].privacyStatus = privacyStatus
            }

            if (notifyVideoData[channelId].videos[videoId].isCollab) {
              if (channelId === videoItem.snippet?.channelId) {
                notifyVideoData[channelId].videos[videoId].isCollab = false
              } else {
                if (videoItem.snippet?.channelId) {
                  notifyVideoData[channelId].videos[videoId].collabChannelId = videoItem.snippet?.channelId
                }

                if (videoItem.snippet?.channelTitle) {
                  notifyVideoData[channelId].videos[videoId].collabChannelTitle = videoItem.snippet?.channelTitle
                }
              }
            }

            const updatedTime = notifyVideoData[channelId].videos[videoId].updatedTime.toISOString()
            const now = new Date()
            const yesterday = new Date(now.getTime())
            yesterday.setDate(now.getDate() - 1)

            if (notifyVideoData[channelId].videos[videoId].needInsert === true) { // データがない場合はINSERTする
              await runQuery(
                'INSERT INTO youtube_streaming_watcher_notified_videos VALUE {\'channel_id\': ?, \'video_id\': ?, \'created_at\': ?, \'start_time\': ?, \'updated_time\': ?, \'notify_mode\': ?, \'privacy_status\': ?, \'is_live_streaming\': ?}',
                [{ S: channelId }, { S: videoId }, { S: now.toISOString() }, { S: startTimeStr }, { S: updatedTime }, { S: notifyMode }, { S: notifyVideoData[channelId].videos[videoId].privacyStatus }, { BOOL: notifyVideoData[channelId].videos[videoId].isLiveStreaming }]
              )
            } else {
              await runQuery(
                'UPDATE youtube_streaming_watcher_notified_videos SET start_time=? SET updated_time=? SET notify_mode=? SET privacy_status=? SET is_live_streaming=? WHERE channel_id=? AND video_id=?',
                [{ S: startTimeStr }, { S: updatedTime }, { S: notifyMode }, { S: notifyVideoData[channelId].videos[videoId].privacyStatus }, { BOOL: notifyVideoData[channelId].videos[videoId].isLiveStreaming }, { S: channelId }, { S: videoId }]
              )
            }

            // 既に配信開始している、もしくは、動画投稿から1日以上経っている場合は通知しない
            if (
              (notifyVideoData[channelId].videos[videoId].isLiveStreaming && startTime < now) ||
              (!notifyVideoData[channelId].videos[videoId].isLiveStreaming && startTime < yesterday)
            ) {
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

      for (const videoId of needGetStartTimeVideos[channelId]) {
        const showChannelId: string = notifyVideoData[channelId].videos[videoId].collabChannelId || channelId
        const showChannelTitle: string = notifyVideoData[channelId].videos[videoId].collabChannelTitle || notifyVideoData[channelId].title || '(不明)'

        // Slack通知
        const postMessageParams: ChatPostMessageArguments = {
          channel: slackChannel,
          text:
            ':x: 配信削除\n' +
            `チャンネル名: <https://www.youtube.com/channel/${showChannelId}|${showChannelTitle}>\n` +
            `配信URL: <https://www.youtube.com/watch?v=${videoId}>`
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
      for (const [videoId, vd] of Object.entries(cd.videos)) {
        await sleep(1000)
        const dayOfWeeks = ['日', '月', '火', '水', '木', '金', '土']
        const parameters: AttributeValue[] = []
        let text = ''

        if (vd.notifyMode === NotifyMode.Registered) {
          parameters.push({ S: NotifyMode.NotifyRegistered })
          text = ':new: 新着'

          if (vd.isCollab) {
            text += 'コラボ'
          }

          if (vd.isLiveStreaming) {
            text += '配信'
          } else {
            text += '動画'
          }
        } else if (vd.isUpdated) {
          text = ':repeat: '

          if (vd.isCollab) {
            text += 'コラボ'
          }

          if (vd.isLiveStreaming) {
            text += '配信'
          } else {
            text += '動画'
          }

          text += '情報更新'
        } else {
          parameters.push({ S: NotifyMode.NotifyRemind })
          text = ':bell: もうすぐ'

          if (vd.isCollab) {
            text += 'コラボ'
          }

          if (vd.isLiveStreaming) {
            text += '配信開始'
          } else {
            text += '動画公開'
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

        const showChannelId: string = vd.collabChannelId || channelId
        const showChannelTitle: string = vd.collabChannelTitle || cd.title || '(不明)'
        text += '\n' +
                `チャンネル名: <https://www.youtube.com/channel/${showChannelId}|${showChannelTitle}>\n`

        if (vd.isCollab) {
          text += `チャンネル名 (コラボ相手): <https://www.youtube.com/channel/${channelId}|${cd.title}>\n`
        }

        text += `配信名: <https://www.youtube.com/watch?v=${videoId}|${vd.videoTitle}>\n` +
                `開始時刻: ${startTime.getFullYear()}年${startTime.getMonth() + 1}月${startTime.getDate()}日 ` +
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
