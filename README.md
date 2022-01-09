# YouTube streaming watcher

Youtubeの配信開始通知をSlackに流すbotです。

## 動かす方法

### 必要なもの

- Google Cloud Platform API Key (YouTube Data API v3)
- Slack API Token

### ローカルで動かす方法

1. [Pipenv](https://pipenv-ja.readthedocs.io/ja/translate-ja/)で仮想環境を作成します。

    ```sh
    pipenv install
    ```
2. `.env` ファイルを作成し、APIのトークン・キーをセットします。

   `.env.example` をコピーして使うとよいでしょう
3. `channels.py` ファイルを作成し、通知したいチャンネルのID ( `https://www.youtube.com/channel/{チャンネルID}` ) をセットします。

   `channels.py.example` をコピーして使うとよいでしょう
4. スクリプトを実行します。

    ```sh
    pipenv run python main.py
    ```
