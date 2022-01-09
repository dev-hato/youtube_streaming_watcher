import locale
import os
import time

import datetime
import dotenv
import googleapiclient.discovery
import slack

import channels

dotenv.load_dotenv(dotenv.find_dotenv())
locale.setlocale(locale.LC_TIME, 'ja_JP.UTF-8')

jst = datetime.timezone(datetime.timedelta(hours=9))

client = slack.WebClient(token=os.environ['SLACK_API_TOKEN'])
youtube = googleapiclient.discovery.build('youtube', 'v3', developerKey=os.environ['YOUTUBE_API_KEY'])
video_ids = set()

while True:
    for channel_id in channels.channel_ids:
        search_result = youtube.search().list(
            part='snippet',
            channelId=channel_id,
            eventType='upcoming',
            type='video',
        ).execute()

        for search_item in search_result['items']:
            video_id = search_item['id']['videoId']

            if video_id in video_ids:
                continue

            video_ids.add(video_id)
            time.sleep(1)
            videos = youtube.videos().list(
                part='liveStreamingDetails',
                id=video_id
            ).execute()

            for video_item in videos['items']:
                start_time_str = video_item['liveStreamingDetails']['scheduledStartTime'].replace('Z', '+00:00')
                start_time = datetime.datetime.fromisoformat(start_time_str).astimezone(jst)
                client.chat_postMessage(
                    channel='hato-bot-debug',
                    text=os.linesep.join([
                        f"チャンネル名: {search_item['snippet']['channelTitle']}",
                        f"配信名: <https://www.youtube.com/watch?v={video_id}|{search_item['snippet']['title']}>",
                        f"開始時刻: {start_time.strftime('%Y年%m月%d日 (%a) %H時%M分%S秒')}"
                    ])
                )

        time.sleep(1)

    time.sleep(60)
