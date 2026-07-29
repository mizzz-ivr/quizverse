# ISSUE-0026: クイズ公開管理とマイクイズ画面を実装する

## 背景

`POST /api/quizzes` は作成したクイズを `draft` として保存する。一方、従来の公開一覧・詳細・回答・ランキングAPIは `Quiz.status` を参照していなかったため、下書きやアーカイブ済みクイズが一般ユーザーから参照できる余地があった。

本Issueでは、公開APIの境界を `published` に統一し、作成者が自分のクイズを確認して公開・公開終了・再公開できる管理導線を追加する。

## 状態モデル

既存の `QuizStatus` を利用するため、DBマイグレーションは発生しない。

- `draft`: 作成者だけがプレビューできる下書き
- `published`: 一覧・詳細・回答・ランキングの公開対象
- `archived`: 公開終了済み。作成者だけがプレビュー・再公開できる

### 状態遷移

| 現在 | 遷移可能 |
| --- | --- |
| `draft` | `published`, `archived` |
| `published` | `archived` |
| `archived` | `draft`, `published` |

`published` から直接 `draft` へ戻す操作は許可せず、一度 `archived` を経由する。同じ状態を再指定した場合は冪等に現在状態を返し、`published_at` を変更しない。

## 公開境界

`quiz_management_bp.before_app_request` で公開クイズ関連ルートの手前に公開状態チェックを置く。

対象:

- `GET / HEAD /api/quizzes`
- `GET / HEAD /api/quizzes/{quiz_id}`
- `POST /api/quizzes/{quiz_id}/play`
- `GET / HEAD /api/quizzes/{quiz_id}/rankings`
- `GET / HEAD /api/rankings`

FlaskはGETルートへHEADを自動提供するため、GET相当の公開境界はHEADにも同じ判定を適用する。

### 公開一覧

`GET /api/quizzes` は `Quiz.status == published` のみを返す。検索・カテゴリ絞り込み・ページングは既存APIと同じ入力契約を維持する。

### 非公開詳細

- 未認証または非作成者: 404
- 作成者本人: JWT付きリクエストに限りプレビューを返す

存在確認による情報漏えいを避けるため、非作成者には403ではなく404を返す。HEADでも同じ404を返し、レスポンス本文の有無による回避を許さない。

作成者プレビューには以下を追加する。

```json
{
  "viewer_is_author": true,
  "play_enabled": false,
  "management_path": "/my/quizzes"
}
```

正答フラグはプレビューでも返さない。

### 回答・ランキング

回答送信とクイズ別ランキングは `published` のみ許可する。総合ランキングも現在公開中のクイズに保存されたベストプレイだけを集計する。

アーカイブ済みクイズの過去プレイはDBに保持するが、公開ランキング集計からは除外する。

## 作成者向けAPI

### `GET /api/me/quizzes`

JWT必須。

Query:

- `status`: `all | draft | published | archived`
- `page`: 1以上
- `per_page`: 1〜50

Response item:

```json
{
  "id": "1",
  "title": "世界遺産クイズ",
  "description_summary": "初級編",
  "category": "歴史",
  "status": "draft",
  "question_count": 10,
  "play_count": 0,
  "created_at": "2026-07-29T00:00:00+00:00",
  "updated_at": "2026-07-29T00:00:00+00:00",
  "published_at": null,
  "public_path": null,
  "preview_path": "/quizzes/1"
}
```

本人のクイズだけを返し、他ユーザーのクイズは含めない。

### `PATCH /api/me/quizzes/{quiz_id}/status`

JWT必須。

Request:

```json
{
  "status": "published"
}
```

公開時は以下を再検証する。

- 1問以上存在する
- 各問題に2〜6件の選択肢が存在する
- 各問題の正答が1件である

実際に `published` へ遷移した場合だけ `published_at` を現在時刻で更新する。同じ `published` を再送した場合は公開日時を維持する。

本人以外の操作は404とする。

## フロントエンド

### `/my/quizzes`

- ログイン状態確認
- 状態タブ
- 問題数・プレイ数・更新日時
- 下書き公開
- 公開終了
- 再公開
- アーカイブから下書きへの復元
- プレビュー・公開ページ導線
- ローディング・空状態・エラー・成功通知
- 状態変更後は1ページ目へ戻し、空になった最終ページへ取り残されないようにする
- ヘッダー件数は「条件内合計」と「現在ページ内の状態別件数」を明示する

### `/quizzes/{quiz_id}`

従来の一般向けアプリ内詳細を独立画面へ分離する。

- `published`: 回答可能
- 作成者の `draft / archived`: プレビュー表示、回答不可、管理画面導線を表示
- 非作成者の非公開クイズ: 404表示
- 一般プレイヤーには採点完了まで問題解説を表示しない
- 作成者プレビューでは公開前確認のため解説を表示する

公開済みクイズはまず匿名で取得し、404かつ保存済みJWTがある場合だけ作成者プレビューを再試行する。古いJWTが保存されていても、公開済みクイズの閲覧を妨げない。

## 設定

```env
QUIZ_PUBLICATION_ENFORCED=true
```

本番では既定値 `true`。既存テスト設定との互換性のため、`TESTING=true` かつ設定未指定の場合のみ旧ルート動作を維持し、新規公開管理テストでは明示的に `true` を指定する。

## セキュリティ

- 作成者判定はJWT identityと `author_user_id` で行う
- 非公開クイズは第三者へGET・HEADとも404
- 作成者プレビューでも正答フラグを返さない
- 公開状態更新は本人所有クイズだけに限定
- 公開ランキングは現在公開中のクイズだけを集計
- 一般プレイヤーには採点前の解説を表示しない

## テスト

```bash
npm --prefix frontend test
npm --prefix frontend run build
cd backend && PYTHONPATH=. pytest
```

追加検証:

- 下書きが公開一覧へ出ない
- 非作成者が下書き詳細を取得できない
- 作成者だけがプレビューできる
- 下書きへ回答送信できない
- 公開・アーカイブ・復元
- 不正な状態遷移
- 同一状態更新の冪等性
- 他ユーザーによる状態変更拒否
- アーカイブ済みクイズを総合ランキングから除外
- HEADによる非公開クイズ存在確認の防止
- 採点前の解説非表示・採点後表示
- 状態変更後の1ページ目への補正
- ページ内状態件数の集計
- フロントエンドAPIのJWT・query・PATCH payload

## 確認結果

- フロントエンドテスト: `27 passed, 0 failed`
- バックエンドテスト: `60 passed, 1 warning`（6.77秒）
- フロントエンドProduction Build: 成功
  - JavaScript: 252.65 kB（gzip 71.24 kB）
  - CSS: 42.29 kB（gzip 7.20 kB）
  - build: 1.37秒
- 既存警告: `User.query.get()` に関するSQLAlchemy 2.x LegacyAPIWarning
- Codexレビュー5件へ対応
  - 採点前の解説非表示
  - HEADリクエストへの公開境界
  - 同一公開状態更新の冪等性
  - 状態変更後のページ番号補正
  - ページ内件数であることの明示
- Vercel Preview: Vercelチームに `quizverse` プロジェクトが未作成のため未確認

## 受け入れ条件

- [x] 公開一覧にdraft / archivedが含まれない
- [x] 非作成者はdraft / archivedの詳細・回答・ランキングへアクセスできない
- [x] 作成者は自分のクイズ一覧を取得できる
- [x] 他ユーザーのクイズ状態を変更できない
- [x] 作成者がdraftをpublishedへ変更できる
- [x] 作成者がpublishedをarchivedへ変更できる
- [x] `/my/quizzes` から状態変更できる
- [x] 作成直後の下書きを作成者が確認できる
- [x] frontend test / production build / backend testが成功する
- [ ] Vercel Previewで実ブラウザ確認する

## 対象外

- クイズ内容編集
- 削除
- 予約公開
- 限定公開
- 共同編集
- 承認ワークフロー

## 関連

- GitHub Issue #26
- GitHub PR #27
- `backend/app/api/quiz_management.py`
- `frontend/src/public/MyQuizzesApp.jsx`
- `frontend/src/public/QuizDetailApp.jsx`
