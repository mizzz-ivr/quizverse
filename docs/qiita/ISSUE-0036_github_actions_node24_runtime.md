# GitHub ActionsのNode.js 20非推奨警告を公式Actions v6への更新で解消する

## はじめに

GitHub Actionsのテスト自体は成功していても、ログに次の警告が出ることがあります。

```text
Node 20 is being deprecated. This workflow is running with Node 24 by default.
```

これはアプリケーションが利用するNode.jsの警告とは限りません。`actions/checkout`や`actions/setup-*`など、GitHub Action自身が内部で利用するNode.jsランタイムに対する警告の場合があります。

QuizVerseでは公式ActionsをNode.js 24ランタイム対応版へ更新し、旧メジャーの再混入をテストで防止しました。

## 対象のワークフロー

更新前は次の公式Actionsを利用していました。

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-python@v5
- uses: actions/setup-node@v4
```

アプリケーションのフロントエンドテストはNode.js 22で実行していましたが、警告対象は`node-version: "22"`ではなくAction内部のNode.js 20ランタイムでした。

## 変更内容

### 1. 公式Actionsをv6へ更新

```yaml
permissions:
  contents: read

jobs:
  backend-test:
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"

  frontend-build:
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
```

`setup-node@v6`へ更新しても、テスト対象のNode.jsを22から24へ変更する必要はありません。Action内部ランタイムと、セットアップするアプリケーション用Node.jsは別の設定です。

### 2. GitHub tokenの権限を明示

CIはリポジトリ内容の読み取りだけで成立するため、権限を明示しました。

```yaml
permissions:
  contents: read
```

必要以上の権限を与えず、ワークフローの意図も分かりやすくなります。

### 3. 旧メジャーの再混入をテストする

ワークフローを目視だけで管理すると、コピーや競合解消時に古いActionへ戻る可能性があります。

そこで、CIファイルを文字列として検証する軽量なテストを追加しました。

```python
from pathlib import Path


def test_official_github_actions_use_node24_runtime_compatible_major_versions():
    workflow = Path("../.github/workflows/ci.yml").read_text(encoding="utf-8")

    assert workflow.count("uses: actions/checkout@v6") == 2
    assert "uses: actions/setup-python@v6" in workflow
    assert "uses: actions/setup-node@v6" in workflow
    assert "actions/checkout@v4" not in workflow
```

実際のテストでは、旧checkout・setup-python・setup-nodeの参照と`contents: read`も確認しています。

## 注意点

### self-hosted runnerのバージョン

Node.js 24ランタイム対応Actionには、一定以上のActions Runnerバージョンが必要です。GitHub-hosted runnerでは更新済みですが、self-hosted runnerを利用している場合は事前確認が必要です。

### checkout v6の認証情報保存方式

checkout v6では認証情報の保存場所が変更されています。通常のGitHub-hosted runner上でテストするだけなら影響はありませんが、Docker container action内から認証付きGit操作をする構成では公式ドキュメントの互換条件を確認します。

QuizVerseのCIはcheckout後にテストとビルドだけを実行し、コンテナ内からGit pushをしないためv6を採用しました。

### Node.js 22はそのまま

今回の目的はAction内部ランタイムの警告解消です。フロントエンドのNode.js更新は依存関係やVercel互換性を含む別タスクとして扱います。

## まとめ

- Node 20警告の発生元がアプリ本体かAction内部かを切り分ける
- 公式ActionsをNode.js 24対応のv6へ更新する
- GitHub token権限を読み取り専用へ明示する
- 静的テストで旧Actionメジャーの再混入を防止する
- アプリのNode.jsバージョン更新とは別タスクとして扱う

CIが成功している状態でも、非推奨警告を放置しないことで将来の強制移行や突然の実行失敗を避けやすくなります。
