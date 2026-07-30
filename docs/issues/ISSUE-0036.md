# ISSUE-0036 GitHub ActionsをNode.js 24ランタイム対応版へ更新する

## 背景

GitHub ActionsのCIは正常終了していたが、公式ActionsがNode.js 20ランタイムを利用しているため、各ジョブのログに次の非推奨警告が出ていた。

```text
Node 20 is being deprecated. This workflow is running with Node 24 by default.
```

GitHub公式の`actions/checkout`、`actions/setup-python`、`actions/setup-node`では、Node.js 24ランタイム対応のv6が提供されている。

## 目的

- Node.js 20ランタイム非推奨警告を解消する
- 公式Actionsを現行メジャーへ揃える
- 旧メジャーが再導入された場合にCIで検知する
- GitHub tokenの権限を読み取り専用へ明示する

## 変更内容

### CIワークフロー

- `actions/checkout@v4` → `actions/checkout@v6`
- `actions/setup-python@v5` → `actions/setup-python@v6`
- `actions/setup-node@v4` → `actions/setup-node@v6`
- ワークフロー権限へ`contents: read`を追加

アプリケーションがテスト対象とするNode.jsは従来どおり22を維持する。今回更新するNode.js 24は、GitHub公式Action自体を実行する内部ランタイムである。

### 回帰テスト

`backend/tests/test_ci_actions_runtime.py`を追加し、以下を確認する。

- checkoutが2ジョブともv6である
- setup-pythonとsetup-nodeがv6である
- 旧メジャー参照が存在しない
- `contents: read`が宣言されている

## 対象外

- フロントエンド実行環境のNode.js 22から24への更新
- package-lock.jsonの新規導入
- npm installからnpm ciへの変更
- Dependabot設定
- Actionsのcommit SHA固定

## 確認項目

- バックエンド全テスト
- フロントエンド全テスト
- Production Build
- ActionsログからNode 20非推奨警告が消えていること
- 公式Actionsがv6で統一されていること

## DB・環境変数への影響

- DBスキーマ変更なし
- マイグレーション不要
- 環境変数追加なし
- Vercel設定変更なし

## 完了条件

- 最新headのGitHub Actionsが成功する
- Node 20ランタイム非推奨警告が出ない
- 回帰テストが成功する
- PRがmainへマージされる
