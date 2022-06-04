import axios from 'axios'
import sleep from 'sleep-promise'

export async function getTwitterUserName (youtubeChannelId: string): Promise<string> {
  await sleep(1000)
  const url = `https://www.youtube.com/channel/${youtubeChannelId}/about`
  console.log('get:', url)
  const response = await axios.get(url)
  const userNames = response.data.match(/twitter.com%2F([^"]*)"/)

  if (userNames.length < 2) {
    throw new Error(`Twitter ID can not be found on YouTube about page: ${youtubeChannelId}`)
  }

  return userNames[1]
}
