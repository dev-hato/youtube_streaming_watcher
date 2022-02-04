# YouTube streaming watcher

Youtube の配信開始通知を Slack に流す bot です。

## 設定方法

Slack 上で bot に対してリプライを送ることで、設定を変更できます。

### 通知対象のチャンネルを追加する場合

```
@bot add https://www.youtube.com/channel/...
```

### 通知対象のチャンネルを削除する場合

```
@bot delete https://www.youtube.com/channel/...
```

## 開発方法

まず、<https://pre-commit.com/> の手順に従って `pre-commit` をインストールします。  
これにより、[.pre-commit-config.yaml](.pre-commit-config.yaml)の設定に基づいて、コミット時にクレデンシャルが含まれていないかの検査が行われるようになります。

```sh
git clone git@github.com:massongit/youtube_streaming_watcher.git
cd youtube_streaming_watcher
npm install
```

## 動かす方法

### 必要なもの

- Google Cloud Platform API Key (YouTube Data API v3)
- Slack API Token

### ローカルで動かす方法

1. `.env` ファイルを作成し、API のトークンや通知先の Slack チャンネルをセットします。

   `.env.example` をコピーして使うとよいでしょう。

2. Docker コンテナを立ち上げます。

   ```sh
   docker-compose up
   ```
