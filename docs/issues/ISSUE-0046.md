# ISSUE-0046 クイズレビュー・5段階評価

## 目的

プレイ済みユーザーがクイズ品質を評価できるようにし、平均評価をコンテンツ発見へ利用する。

## 採用仕様

- 1ユーザー・1クイズにつき1レビュー
- 評価は1〜5の整数
- コメントは任意、最大1000文字
- 投稿・更新には対象クイズの`submitted`プレイが1件以上必要
- 作成者本人の自己評価は禁止
- `published`だけレビュー公開・投稿可能
- 非公開化してもレビュー行は保持し、再公開時に復帰
- 本人レビューはupsert、削除は冪等

## DB

`quiz_reviews`

| column | type | null | note |
| --- | --- | --- | --- |
| user_id | BIGINT | NO | PK, users.id, CASCADE |
| quiz_id | BIGINT | NO | PK, quizzes.id, CASCADE |
| rating | INTEGER | NO | 1〜5 CheckConstraint |
| body | TEXT | YES | API上1000文字以内 |
| created_at | timestamptz | NO | 作成日時 |
| updated_at | timestamptz | NO | 更新日時 |

- PK: `(user_id, quiz_id)`
- Index: `ix_quiz_reviews_quiz_id`
- Check: `ck_quiz_reviews_rating_range`
- migration: `20260812_0011`
- down revision: `20260812_0010`

## API

### GET `/api/quizzes/{quiz_id}/reviews`

公開レビュー一覧。新しい更新順で返す。

レスポンスには以下を含む。

- `summary.rating_average`
- `summary.review_count`
- `items`
- `pagination`

### GET `/api/quizzes/{quiz_id}/reviews/me`

認証必須。本人レビューと投稿可否を返す。

`eligibility.reason`:

- `author`: 作成者本人
- `not_played`: submitted playなし
- `null`: 投稿可能

### PUT `/api/quizzes/{quiz_id}/reviews/me`

認証必須。新規時201、更新時200。

```json
{
  "rating": 5,
  "body": "面白かった"
}
```

### DELETE `/api/quizzes/{quiz_id}/reviews/me`

認証必須。本人レビューを削除。未投稿でも200で`meta.changed=false`。

### GET `/api/quizzes?sort=rating`

平均評価降順で公開クイズを返す。同率時は次の順で比較する。

1. レビュー件数降順
2. 公開日時降順
3. クイズID降順

通常の`sort=latest`レスポンスとクイズ詳細にも`rating_average`と`review_count`を追加する。

## フロントエンド

### `/top-rated`

高評価クイズ専用ページ。

- 平均評価
- 星表示
- レビュー件数
- カテゴリ
- 問題数
- キーワード検索
- カテゴリ絞り込み
- ページング

既存`PublicQuizApp`の巨大化を避けるため、一覧画面内のsort切替ではなく独立画面として実装した。API自体は`sort=latest|rating`を提供するため、将来既存一覧へ統合可能。

### クイズ詳細

`QuizDetailSessionGate`の認証確認後に`ReviewQuickAction`を描画する。

- 平均評価と件数を固定ボタン表示
- Drawerでレビュー一覧
- 5段階評価
- コメント投稿・編集・削除
- 未ログイン時ログイン導線
- 未プレイ時は投稿不可理由と再確認ボタン
- 作成者は自己評価不可

## セキュリティ

- JWT/Cookie認証は既存方式を利用
- PUT/DELETEはCSRFヘッダーを送信
- `resolve_current_user`でactive状態を再確認
- 他ユーザーのreview IDを更新API引数として受け取らない
- 非公開クイズのレビュー一覧・本人取得・upsertは404
- DELETEは本人複合PKだけを対象とする

## テスト観点

- rating 0/6/bool/string拒否
- body 1001文字拒否
- 未認証401
- suspended 403
- 未プレイ403
- 作成者403
- 非公開404
- create/update/delete
- 平均評価・件数
- ページング
- 他ユーザーreview非破壊
- `sort=rating`
- latest/detailへの評価集計追加
- migration契約
- frontend API契約
- frontend表示モデル
- セッションゲート統合
- Production Build

## 後続候補

- レビュー通報
- 管理者モデレーション
- スパム・連投対策
- ベイズ平均/Wilson scoreによる高評価ランキング補正
- レビューへの「参考になった」投票
