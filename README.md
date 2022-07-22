# YouTube streaming watcher

YouTubeの配信通知をSlackに流すbotです。

## 通知される条件

次の場合に通知されます。

* 配信枠が作成されたとき
* 配信1時間前
* 配信情報が変更されたとき
* 配信枠が削除されたとき

## 設定方法

Slack上でbotに対してリプライを送ることで、設定を変更できます。

### 通知対象のチャンネル一覧を表示する場合

<!-- markdownlint-disable MD040 -->

```
@bot list
```

<!-- markdownlint-enable MD040 -->

### 通知対象のチャンネルを追加する場合

<!-- markdownlint-disable MD040 -->

```
@bot add https://www.youtube.com/channel/...
```

<!-- markdownlint-enable MD040 -->

### 通知対象のチャンネルを削除する場合

<!-- markdownlint-disable MD040 -->

```
@bot delete https://www.youtube.com/channel/...
```

<!-- markdownlint-enable MD040 -->

## 開発方法

<https://pre-commit.com/> の手順に従って `pre-commit` をインストールします。  
これにより、[.pre-commit-config.yaml](.pre-commit-config.yaml)の設定に基づいて、コミット時にクレデンシャルが含まれていないかの検査が行われるようになります。

## 動かす方法

### 必要なもの

- Google Cloud Platform API Key (YouTube Data API v3)
- Slack API Token
- Twitter API

### AWSへデプロイする方法

1. AWS CLIをインストールします。
2. 実行に必要なパッケージをインストールします。

   ```sh
   npm install
   ```
3. スタックのデプロイで使用するS3バケットを作成します。

   ```sh
   cdk bootstrap
   ```
4. AWSコンソールのSecret Manager上で次のSecretを作成します。
    * `youtube_streaming_watcher_slack`: 配信通知関連 (Slack)
        * `slack_bot_token`: Slackのbotトークン
        * `slack_signing_secret`: SlackのSigning Secret
        * `slack_channel`: 通知先のチャンネル名
    * `youtube_streaming_watcher_slack_alert`: Lambda関数のアラート関連 (Slack)
        * `workspace_id`: 通知先のワークスペースID
        * `channel_id`: 通知先のチャンネルID
    * `youtube_streaming_watcher_twitter`: 配信通知関連 (Twitter)
        * `twitter_bearer_token`: ベアラートークン
    * `youtube_streaming_watcher_youtube`: 配信通知関連 (YouTube)
        * `youtube_api_key`: YouTube Data API用のAPIキー
5. スタックをデプロイします。  
なお、リポジトリが `dev-hato/youtube_streaming_watcher` 以外の場合は環境変数 `REPOSITORY=org/repository` をセットした状態で実行します。

   ```sh
   cdk deploy
   ```

次回以降デプロイするときは `youtube_streaming_watcher_cdk_deploy` Roleを使用します。  
また、スタックの差分を見るときは `youtube_streaming_watcher_cdk_diff` Roleで `cdk diff` を実行します。

### ローカルで動かす方法

1. `.env` ファイルを作成し、APIのトークンや通知先のSlackチャンネルをセットします。

   `.env.example` をコピーして使うとよいでしょう。

2. Dockerコンテナを立ち上げます。  
   Dockerイメージのビルドに失敗する場合はDockerに割り当てるメモリを増やしてみてください (5GB程度割り当てれば足りるはずです)。

   ```sh
   TAG_NAME=$(git symbolic-ref --short HEAD | sed -e "s:/:-:g" | sed -e "s/^main$/latest/g") docker compose up
   ```

### forkしたリポジトリでCI/CDを動かす方法

次のRepository secretsを設定します。

* `AWS_ACCOUNT`: AWSアカウントID
* `AWS_REGION`: AWSのリージョン

## 仕様

### Node.jsのバージョン

次の2つのバージョンを使用できるようにしていますが、基本的には後者を前提として開発しています。
* dependabotで使用しているバージョン: <https://github.com/dependabot/dependabot-core/blob/31daef5ef4c96d83003777316e96a14eecddd190/Dockerfile#L100-L105>
* AWS LambdaのNode.jsランタイムで対応している最新バージョン: <!-- textlint-disable terminology --><https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/lambda-runtimes.html><!-- textlint-enable -->

### npmのバージョン

dependabotで使用しているバージョンに準拠しています。

<https://github.com/dependabot/dependabot-core/blob/31daef5ef4c96d83003777316e96a14eecddd190/Dockerfile#L100-L105>
