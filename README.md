# YouTube streaming watcher

YouTubeの配信開始通知をSlackに流すbotです。

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

### ローカルで動かす方法

1. `.env` ファイルを作成し、APIのトークンや通知先のSlackチャンネルをセットします。

   `.env.example` をコピーして使うとよいでしょう。

2. Dockerコンテナを立ち上げます。  
   Dockerイメージのビルドに失敗する場合はDockerに割り当てるメモリを増やしてみてください (3GB程度割り当てれば足りるはずです)。

   ```sh
   TAG_NAME=$(git symbolic-ref --short HEAD | sed -e "s:/:-:g" | sed -e "s/^main$/latest/g") docker compose up
   ```

## 仕様

### Node.jsのバージョン

以下の2つのバージョンを使用できるようにしていますが、基本的には後者を前提として開発しています。
* dependabotで使用しているバージョン: <https://github.com/dependabot/dependabot-core/blob/31daef5ef4c96d83003777316e96a14eecddd190/Dockerfile#L100-L105>
* AWS LambdaのNode.jsランタイムで対応している最新バージョン: <https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/lambda-runtimes.html>

### npmのバージョン

dependabotで使用しているバージョンに準拠しています。

<https://github.com/dependabot/dependabot-core/blob/31daef5ef4c96d83003777316e96a14eecddd190/Dockerfile#L100-L105>
