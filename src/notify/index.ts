import axios, { AxiosError } from 'axios'
import Parser from 'rss-parser'
import sleep from 'sleep-promise'
import { TweetV2, TweetV2UserTimelineParams, ApiResponseError } from 'twitter-api-v2'
import { AttributeValue } from '@aws-sdk/client-dynamodb'
import { ChatPostMessageArguments } from '@slack/web-api'
import { google, youtube_v3 } from 'googleapis' // eslint-disable-line camelcase
import { runQuery } from '../common/dynamodb'
import { slackApp } from '../common/slack'
import { twitterApiReadOnly } from '../common/twitter'

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

enum NextNotificationTimeName {
  YoutubeDataApiUnitLimitPerDay = 'YoutubeDataApiUnitLimitPerDay',
  TwitterApiGetTweetLimitPerMonth = 'TwitterApiGetTweetLimitPerMonth',
  TwitterApiRequestLimitPerMinutes = 'TwitterApiRequestLimitPerMinutes'
}

interface Video {
  videoTitle?: string
  startTime?: Date
  updatedTime: Date
  notifyMode?: string
  needInsert: boolean
  isUpdated: boolean
  isLiveStreaming: boolean
  privacyStatus: string
  /** コラボ配信か **/
  isCollab: boolean
  /** 配信のチャンネルID (コラボ配信の場合のみ入る) **/
  collabChannelId?: string
  /** 配信のチャンネルタイトル (コラボ配信の場合のみ入る) **/
  collabChannelTitle?: string
}

function generatePostText (channelId: string, videoId: string, title?: string, video?: Video): string {
  let showChannelId: string

  if (video?.collabChannelId === undefined) {
    showChannelId = channelId
  } else {
    showChannelId = video.collabChannelId
  }

  let showChannelTitle: string

  if (video?.collabChannelTitle !== undefined) {
    showChannelTitle = video.collabChannelTitle
  } else if (title !== undefined) {
    showChannelTitle = title
  } else {
    showChannelTitle = '(不明)'
  }

  let text = '\n' +
        `チャンネル名: <https://www.youtube.com/channel/${showChannelId}|${showChannelTitle}>\n`

  if (title !== undefined && video?.isCollab === true) {
    text += `チャンネル名 (コラボ相手): <https://www.youtube.com/channel/${channelId}|${title}>\n`
  }

  if (video?.videoTitle === undefined) {
    text += '配信URL'
  } else {
    text += '配信名'
  }

  text += `: <https://www.youtube.com/watch?v=${videoId}`

  if (video?.videoTitle !== undefined) {
    text += `|${video.videoTitle}`
  }

  return text + '>'
}

// Youtube Data APIの1日あたりの上限ユニット数
const youtubeDataApiUnitLimitPerDay = 10000

// Twitter APIの1ヶ月あたりの上限取得ツイート数
const twitterApiGetTweetLimitPerMonth = 500000

// Twitter APIの15分あたりの上限リクエスト数
const twitterApiRequestLimitPerMinutes = 900

const maxGetFeedRetryCnt = 10

export async function handler (): Promise<void> {
  const currentNotificationTimes: { [name: string]: Date } = {}
  const currentNotificationAtItems = await runQuery(
    'SELECT name, next_notification_at FROM youtube_streaming_watcher_next_notification_times2'
  )
  const currentTime = new Date()

  for (const currentNotificationAtItem of currentNotificationAtItems) {
    const name = currentNotificationAtItem.name.S
    const currentNotificationAt = currentNotificationAtItem.next_notification_at.S

    if (name === undefined || currentNotificationAt === undefined) {
      continue
    }

    currentNotificationTimes[name] = new Date(currentNotificationAt)

    if (name !== NextNotificationTimeName.YoutubeDataApiUnitLimitPerDay &&
        currentTime < currentNotificationTimes[name]) {
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
  let youtubeDataApiUnitNum = 0

  // Twitter APIでの取得ツイート数
  let twitterApiGetTweetNum = 0

  // Twitter APIへのリクエスト数
  let twitterApiRequestNum = 0

  try {
    const notifyVideoData: {
      /** チャンネルID
        * 通常は配信のチャンネルIDが入る
        * コラボ配信の場合は配信をツイートした配信者のチャンネルIDが入る
        * **/
      [channelId: string]: {
        title?: string
        videos: Map<string, Video>
      }
    } = {}

    const channels = await runQuery('SELECT channel_id, twitter_id FROM youtube_streaming_watcher_channels')

    if (channels.length === 0) {
      console.log('registered channels are not found')
      return
    }

    const videoIds = new Set()
    const videoIdsPerChannels: { [channelId: string]: Set<string> } = {}
    const needGetStartTimeVideos: { [channelId: string]: Set<string> } = {}

    // 新着配信一覧取得
    for (const { channel_id: { S: channelId } } of channels) {
      if (channelId === undefined) {
        continue
      }

      const feedParser = new Parser<Record<string, never>, { id: string, updated: string }>({
        customFields: { item: ['id', 'updated'] }
      })
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

      videoIdsPerChannels[channelId] = new Set()
      needGetStartTimeVideos[channelId] = new Set()
      notifyVideoData[channelId] = { title: feed.title, videos: new Map() }

      for (const item of feed.items) {
        const videoId = item.id.replace(/^yt:video:/, '')
        notifyVideoData[channelId].videos.set(videoId, {
          videoTitle: item.title,
          updatedTime: new Date(item.updated),
          needInsert: true,
          isUpdated: false,
          isLiveStreaming: true,
          privacyStatus: PrivacyStatus.Public,
          isCollab: false
        })
        videoIds.add(videoId)
        videoIdsPerChannels[channelId].add(videoId)
        needGetStartTimeVideos[channelId].add(videoId)
      }
    }

    for (const channel of channels) {
      if (channel.channel_id?.S === undefined) {
        continue
      }

      const channelId = channel.channel_id.S
      const twitterId = channel.twitter_id?.S

      if (twitterId !== undefined) {
        const tweetDatas: Array<{ tweetId: string, videoId: string, updatedTime: Date }> = []
        let sinceTweetId: string | null = null
        const tweetIdSet: Set<string> = new Set()
        const tweetIdResults = await runQuery(
          'SELECT tweet_id FROM youtube_streaming_watcher_tweets WHERE twitter_id = ?',
          [{ S: twitterId }]
        )

        if (tweetIdResults.length > 0) {
          const tweetIds: AttributeValue[] = []

          for (const tweetIdResult of tweetIdResults) {
            if (tweetIdResult.tweet_id?.S === undefined) {
              continue
            }

            tweetIdSet.add(tweetIdResult.tweet_id.S)
            tweetIds.push({ S: tweetIdResult.tweet_id.S })

            if (sinceTweetId === null || Number(sinceTweetId) < Number(tweetIdResult.tweet_id.S)) {
              sinceTweetId = tweetIdResult.tweet_id.S
            }
          }

          const tweetDataResults = await runQuery(
            'SELECT tweet_id, video_id, updated_time FROM youtube_streaming_watcher_tweet_videos ' +
            'WHERE tweet_id IN (' + tweetIds.map(() => '?').join(', ') + ')',
            tweetIds
          )

          for (const tweetDataResult of tweetDataResults) {
            if (tweetDataResult.tweet_id.S !== undefined &&
                tweetDataResult.video_id.S !== undefined &&
                tweetDataResult.updated_time.S !== undefined) {
              tweetDatas.push({
                tweetId: tweetDataResult.tweet_id.S,
                videoId: tweetDataResult.video_id.S,
                updatedTime: new Date(tweetDataResult.updated_time.S)
              })
            }
          }
        }

        if ((currentNotificationTimes[NextNotificationTimeName.TwitterApiRequestLimitPerMinutes] === undefined ||
            currentNotificationTimes[NextNotificationTimeName.TwitterApiRequestLimitPerMinutes] <= currentTime) &&
            (currentNotificationTimes[NextNotificationTimeName.TwitterApiGetTweetLimitPerMonth] === undefined ||
            currentNotificationTimes[NextNotificationTimeName.TwitterApiGetTweetLimitPerMonth] <= currentTime)) {
          await sleep(1000)
          console.log('get twitter user timeline:', twitterId)
          const userTimelineOptions: TweetV2UserTimelineParams = {
            max_results: 10,
            exclude: 'replies'
          }

          if (sinceTweetId !== null) {
            userTimelineOptions.since_id = sinceTweetId
          }

          let timeLine
          let tweets: TweetV2[] = []

          try {
            timeLine = await twitterApiReadOnly.v2.userTimeline(twitterId, userTimelineOptions)
            twitterApiRequestNum++
            tweets = timeLine.tweets
            twitterApiGetTweetNum += tweets.length
          } catch (e) {
            if (e instanceof ApiResponseError && e.rateLimitError) {
              console.error(e)
            } else {
              throw e
            }
          }

          const tweetDataList: Array<{
            twitterId: string
            tweetId: string
            url: string | undefined
            createdAt: string | undefined
          }> = []
          const maxGetTweetCount = 2

          for (let i = 0; i < maxGetTweetCount && tweets.length > 0; i++) {
            const tweetIds: string[] = []

            for (const tweet of tweets) {
              for (const shortUrl of tweet.text.matchAll(/https:\/\/t\.co\/[a-zA-Z\d]+/g)) {
                const tweetUrl = shortUrl[0]
                let url

                try {
                  await sleep(1000)
                  const response = await axios.get(tweetUrl)
                  url = response.request.res.responseUrl
                  console.log('get:', tweetUrl, '->', url, response.statusText)
                } catch (e) {
                  if (e instanceof AxiosError && e.response !== undefined) {
                    console.log('get:', tweetUrl, e.response.statusText)
                    continue
                  }

                  console.log('get:', tweetUrl, e)
                  continue
                }

                const twitterIdPattern = url.match(/https:\/\/twitter\.com\/[^/]+\/status\/([^/]+)/)

                if ((twitterIdPattern === null || twitterIdPattern.length < 2) && twitterId !== undefined) {
                  const tweetId = tweet.id

                  if (!tweetIdSet.has(tweetId)) {
                    tweetIdSet.add(tweetId)
                    tweetDataList.push({ twitterId, tweetId, url, createdAt: tweet.created_at })
                  }

                  continue
                }

                const tweetId = twitterIdPattern[1]

                if (tweet.id !== tweetId) {
                  tweetIds.push(tweetId)
                }
              }
            }

            if (tweetIds.length === 0 || i === maxGetTweetCount - 1) {
              break
            }

            await sleep(1000)
            console.log('get tweets:', tweetIds)
            let tweetsResult

            try {
              tweetsResult = await twitterApiReadOnly.v2.tweets(tweetIds)
              twitterApiRequestNum++
              tweets = tweetsResult.data
              twitterApiGetTweetNum += tweets.length
            } catch (e) {
              if (e instanceof ApiResponseError && e.rateLimitError) {
                console.error(e)
                break
              }

              throw e
            }
          }

          for (const { twitterId, tweetId, url, createdAt } of tweetDataList) {
            await runQuery(
              'INSERT INTO youtube_streaming_watcher_tweets VALUE {\'twitter_id\': ?, \'tweet_id\': ?}',
              [{ S: twitterId }, { S: tweetId }]
            )

            if (url === undefined) {
              continue
            }

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

            if (createdAt !== undefined) {
              updatedTime = new Date(createdAt)
            }

            await runQuery(
              'INSERT INTO youtube_streaming_watcher_tweet_videos VALUE {\'tweet_id\': ?, \'video_id\': ?, \'updated_time\': ?}',
              [{ S: tweetId }, { S: videoId }, { S: updatedTime.toISOString() }]
            )
            tweetDatas.push({ tweetId, videoId, updatedTime })
          }
        }

        for (const tweetData of tweetDatas) {
          notifyVideoData[channelId].videos.set(tweetData.videoId, {
            updatedTime: tweetData.updatedTime,
            needInsert: true,
            isUpdated: false,
            isLiveStreaming: true,
            privacyStatus: PrivacyStatus.Public,
            isCollab: true
          })
          videoIds.add(tweetData.videoId)
          videoIdsPerChannels[channelId].add(tweetData.videoId)

          if (needGetStartTimeVideos[channelId] === undefined) {
            needGetStartTimeVideos[channelId] = new Set<string>()
          }

          needGetStartTimeVideos[channelId].add(tweetData.videoId)
        }
      }

      if (videoIds.size === 0) {
        console.log(`videos can not be get from feed: channelId: ${channelId}`)
        continue
      }

      const videoIdList = Array.from(videoIdsPerChannels[channelId])

      // 登録済み配信取得
      const postedVideos = await runQuery(
        'SELECT video_id, start_time, updated_time, notify_mode, privacy_status, is_live_streaming FROM youtube_streaming_watcher_notified_videos ' +
                'WHERE channel_id=? AND video_id IN (' + videoIdList.map(() => '?').join(', ') + ')',
        [{ S: channelId }].concat(videoIdList.map(v => {
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

          // 次のいずれかを満たしている場合は通知しない
          // * 配信開始の1時間以上前
          // * 既に配信開始済み
          // * 配信開始まで1時間以内でリマインド通知が完了している
          if (now < oneHourAgoTime || startTime < now || notifyMode === NotifyMode.NotifyRemind) {
            console.log(`skip: channel_id ${channelId}, video_id: ${videoId}`)
            needGetStartTimeVideos[channelId].delete(videoId)
            notifyVideoData[channelId].videos.delete(videoId)
            continue
          } else if (updateTime !== undefined && video !== undefined && new Date(updateTime) < video.updatedTime) {
            video.isUpdated = true
          } else {
            needGetStartTimeVideos[channelId].delete(videoId)
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

      if (needGetStartTimeVideos[channelId].size === 0) {
        console.log(`videos that need get start time are not found: channel_id: ${channelId}`)
        continue
      }

      const needGetStartTimeVideoList = Array.from(needGetStartTimeVideos[channelId])

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
        youtubeDataApiUnitNum++

        const items = videoResult.data.items

        if (items !== undefined) {
          for (const videoItem of items) {
            const videoId = videoItem.id

            if (videoId === undefined || videoId === null) {
              console.log('video data can not get')
              continue
            }

            needGetStartTimeVideos[channelId].delete(videoId)
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

            if (video?.isCollab) {
              if (channelId === videoItem.snippet?.channelId) {
                video.isCollab = false
              } else {
                if (videoItem.snippet?.channelId !== null) {
                  video.collabChannelId = videoItem.snippet?.channelId
                }

                if (videoItem.snippet?.channelTitle !== null) {
                  video.collabChannelTitle = videoItem.snippet?.channelTitle
                }
              }
            }

            const updatedTime = video.updatedTime.toISOString()
            const now = new Date()
            const yesterday = new Date(now.getTime())
            yesterday.setDate(now.getDate() - 1)

            if (video.needInsert) { // データがない場合はINSERTする
              await runQuery(
                'INSERT INTO youtube_streaming_watcher_notified_videos VALUE {\'channel_id\': ?, \'video_id\': ?, \'created_at\': ?, \'start_time\': ?, \'updated_time\': ?, \'notify_mode\': ?, \'privacy_status\': ?, \'is_live_streaming\': ?}',
                [
                  { S: channelId },
                  { S: videoId },
                  { S: now.toISOString() },
                  { S: startTimeStr },
                  { S: updatedTime },
                  { S: notifyMode },
                  { S: video.privacyStatus },
                  { BOOL: video.isLiveStreaming }
                ]
              )
            } else {
              await runQuery(
                'UPDATE youtube_streaming_watcher_notified_videos SET start_time=? SET updated_time=? SET notify_mode=? SET privacy_status=? SET is_live_streaming=? WHERE channel_id=? AND video_id=?',
                [
                  { S: startTimeStr },
                  { S: updatedTime },
                  { S: notifyMode },
                  { S: video.privacyStatus },
                  { BOOL: video.isLiveStreaming },
                  { S: channelId },
                  { S: videoId }
                ]
              )
            }

            // 既に配信開始している、もしくは、動画投稿から1日以上経っている場合は通知しない
            if ((video.isLiveStreaming && startTime < now) || (!video.isLiveStreaming && startTime < yesterday)) {
              console.log(
                'start time has passed:',
                  `channel_id ${channelId}, video_id: ${videoId}, start_time: ${startTime.toISOString()}`
              )
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

      for (const videoId of needGetStartTimeVideos[channelId]) {
        // Slack通知
        const postMessageParams: ChatPostMessageArguments = {
          channel: slackChannel,
          text: ':x: 配信削除\n' +
                generatePostText(
                  channelId,
                  videoId,
                  notifyVideoData[channelId].title,
                  notifyVideoData[channelId].videos.get(videoId)
                )
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
        } else if (vd.isUpdated) {
          text = ':repeat: '
        } else {
          parameters.push({ S: NotifyMode.NotifyRemind })
          text = ':bell: もうすぐ'
        }

        if (vd.isCollab) {
          text += 'コラボ'
        }

        if (vd.isLiveStreaming) {
          text += '配信'
        } else {
          text += '動画'
        }

        if (vd.notifyMode !== NotifyMode.Registered) {
          if (vd.isUpdated) {
            text += '情報更新'
          } else if (vd.isLiveStreaming) {
            text += '開始'
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

        text += generatePostText(channelId, videoId, cd.title, vd) + '\n' +
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
  } catch (e) {
    console.error(e)
    throw e
  } finally { // 次回実行時刻設定
    const sleepSeconds: { [name: string]: number } = {}

    // Youtube Data API: APIリクエストの消費ユニット数 * 24時間 * 60分 * 60秒 / 1日あたりの上限ユニット数
    sleepSeconds[NextNotificationTimeName.YoutubeDataApiUnitLimitPerDay] = Math.ceil(youtubeDataApiUnitNum * 24 * 60 * 60 / youtubeDataApiUnitLimitPerDay + 1)

    // Twitter API: 取得ツイート数 * 1ヶ月 (31日) * 24時間 * 60分 * 60秒 / 1ヶ月あたりの上限取得ツイート数
    sleepSeconds[NextNotificationTimeName.TwitterApiGetTweetLimitPerMonth] = Math.ceil(twitterApiGetTweetNum * 31 * 24 * 60 * 60 / twitterApiGetTweetLimitPerMonth + 1)

    // Twitter API: APIリクエスト回数 * 15分 * 60秒 / 15分あたりの上限リクエスト数
    sleepSeconds[NextNotificationTimeName.TwitterApiRequestLimitPerMinutes] = Math.ceil(twitterApiRequestNum * 15 * 60 / twitterApiRequestLimitPerMinutes + 1)

    const nextNotificationAtBase = new Date()

    for (const name in currentNotificationTimes) {
      if (currentNotificationTimes[name] !== undefined && currentTime < currentNotificationTimes[name]) {
        break
      }

      await runQuery(
        'DELETE FROM youtube_streaming_watcher_next_notification_times2 WHERE name=? and next_notification_at=?',
        [{ S: name }, { S: currentNotificationTimes[name].toISOString() }]
      )
      const nextNotificationAt = new Date(nextNotificationAtBase)
      nextNotificationAt.setSeconds(nextNotificationAtBase.getSeconds() + sleepSeconds[NextNotificationTimeName.YoutubeDataApiUnitLimitPerDay])
      await runQuery(
        'INSERT INTO youtube_streaming_watcher_next_notification_times2 VALUE {\'name\': ?, \'next_notification_at\': ?}',
        [{ S: name }, { S: nextNotificationAt.toISOString() }]
      )

      if (name === NextNotificationTimeName.YoutubeDataApiUnitLimitPerDay) {
        console.log('next notify at ', nextNotificationAt)
      }
    }
  }
}
