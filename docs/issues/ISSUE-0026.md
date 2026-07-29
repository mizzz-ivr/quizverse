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

`published` から直接 `draft` へ戻す操作は許可せず、一度 `archived` を経由する。

## 公開境界

`quiz_management_bp.before_app_request` で公開クイズ関連ルートの手前に公開状態チェックを置く。

対象:

- `GET /api/quizzes`
- `GET /api/quizzes/{quiz_id}`
- `POST /api/quizzes/{quiz_id}/play`
- `GET /api/quizzes/{quiz_id}/rankings`
- `GET /api/rankings`

### 公開一覧

`GET /api/quizzes` は `Quiz.status == published` のみを返す。検索・カテゴリ絞り込み・ページングは既存APIと同じ入力契約を維持する。

### 非公開詳細

- 未認証または非作成者: 404
- 作成者本人: JWT付きリクエストに限りプレビューを返す

存在確認による情報漏えいを避けるため、非作成者には403ではなく404を返す。

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

公開成功時は `published_at` を現在時刻で更新する。

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

### `/quizzes/{quiz_id}`

従来の一般向けアプリ内詳細を独立画面へ分離する。

- `published`: 回答可能
- 作成者の `draft / archived`: プレビュー表示、回答不可、管理画面導線を表示
- 非作成者の非公開クイズ: 404表示

## 設定

```env
QUIZ_PUBLICATION_ENFORCED=true
```

本番では既定値 `true`。既存テスト設定との互換性のため、`TESTING=true` かつ設定未指定の場合のみ旧ルート動作を維持し、新規公開管理テストでは明示的に `true` を指定する。

## セキュリティ

- 作成者判定はJWT identityと `author_user_id` で行う
- 非公開クイズは第三者へ404
- 作成者プレビューでも正答フラグを返さない
- 公開状態更新は本人所有クイズだけに限定
- 公開ランキングは現在公開中のクイズだけを集計

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
- 他ユーザーによる状態変更拒否
- アーカイブ済みクイズを総合ランキングから除外
- フロントエンドAPIのJWT・query・PATCH payload

## 対象外

- クイズ内容編集
- 削除
- 予約公開
- 限定公開
- 共同編集
- 承認ワークフロー

## 関連

- GitHub Issue #26
- `backend/app/api/quiz_management.py`
- `frontend/src/public/MyQuizzesApp.jsx`
- `frontend/src/public/QuizDetailApp.jsx`
