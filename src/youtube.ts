import { setTimeout } from 'timers/promises'
import { google } from 'googleapis'
import { postgresClient } from './db'
import { slackApp } from './slack'

export async function startVideoNotify (): Promise<void> {
  // Youtube Data APIの1日あたりの上限ユニット数
  const apiUnitLimitPerDay = 10000

  if (process.env.SLACK_CHANNEL === undefined) {
    throw new Error('SLACK_CHANNEL must be set.')
  }

  const slackChannel = process.env.SLACK_CHANNEL
  const api = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
  })

  while (1) {
    let apiCallCnt = 0
    const channels = await postgresClient.query(
      'SELECT channel_id FROM channels'
    )

    for (const { channel_id: channelId } of channels.rows) {
      // チャンネルの配信一覧
      const searchListParams = {
        part: ['snippet'],
        eventType: 'upcoming',
        type: ['video'],
        channelId
      }
      console.log('call youtubeApi.search.list: ', searchListParams)
      const searchList = await api.search.list(searchListParams)
      apiCallCnt++

      if (searchList.data.items) {
        for (let searchItem of searchList.data.items) {
          if (searchItem.snippet && searchItem.id?.videoId) {
            // 動画ID
            const videoId = searchItem.id.videoId
            const postedVideos = await postgresClient.query(
              'SELECT video_id FROM videos WHERE channel_id=$1 AND video_id=$2',
              [channelId, videoId]
            )

            // 通知済みの配信の場合はスキップ
            if (postedVideos.rowCount > 0) {
              console.log(
                `skip: channel_id ${channelId}, video_id: ${videoId}`
              )
              continue
            }

            await postgresClient.query('BEGIN')
            await postgresClient.query(
              'INSERT INTO videos(channel_id, video_id, created_at) VALUES ($1, $2, $3)',
              [channelId, videoId, new Date()]
            )
            await postgresClient.query('COMMIT')

            await setTimeout(1000)

            // 配信情報
            const videoResultParams = {
              part: ['liveStreamingDetails'],
              id: [videoId]
            }
            console.log('call youtubeApi.videos.list: ', videoResultParams)
            const videoResult = await api.videos.list(videoResultParams)
            apiCallCnt++

            if (videoResult.data.items) {
              for (const videoItem of videoResult.data.items) {
                if (videoItem.liveStreamingDetails?.scheduledStartTime) {
                  await setTimeout(1000)
                  const startTime = new Date(
                    Date.parse(
                      videoItem.liveStreamingDetails.scheduledStartTime
                    )
                  )
                  const dayOfWeeks = ['日', '月', '火', '水', '木', '金', '土']

                  // Slack通知
                  const postMessageParams = {
                    channel: slackChannel,
                    text:
                      'チャンネル名: ' +
                      searchItem.snippet.channelTitle +
                      '\n' +
                      '配信名: <https://www.youtube.com/watch?v=' +
                      videoId +
                      '|' +
                      searchItem.snippet.title +
                      '>\n' +
                      `開始時刻: ${startTime.getFullYear()}年${startTime.getMonth()}月${startTime.getDate()}日 (${
                        dayOfWeeks[startTime.getDay()]
                      }) ${startTime.getHours()}時${startTime.getMinutes()}分${startTime.getSeconds()}秒`
                  }
                  console.log(
                    'call app.client.chat.postMessage: ',
                    postMessageParams
                  )
                  await slackApp.client.chat.postMessage(postMessageParams)
                }
              }
            }
          }
        }
      }

      await setTimeout(1000)
    }

    // APIリクエスト1回あたりの消費ユニット数 * APIリクエスト回数 * 24時間 * 60分 * 60秒 / 1日あたりの上限ユニット数 + 1秒
    // APIリクエスト回数は配信が少ない時間にAPIを叩きすぎないよう、対象の全チャンネルで新たな配信が1本控えている状態を下限としている
    apiCallCnt = Math.max(apiCallCnt, 2 * channels.rowCount)
    const sleepSeconds = Math.ceil(
      (3 * apiCallCnt * 24 * 60 * 60) / apiUnitLimitPerDay + 1
    )
    console.log(`sleep: ${sleepSeconds}s`)
    await setTimeout(sleepSeconds * 1000)
  }
}
