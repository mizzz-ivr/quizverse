# ISSUE-0044 クイズのお気に入り保存とあとで遊ぶ一覧

## 背景

QuizVerseでは公開クイズを検索して回答できるが、気になったクイズを保存して後から見つけ直す導線がなかった。

ブラウザローカル保存では端末やブラウザをまたげないため、ユーザーとクイズの組み合わせをDBへ保存するお気に入り機能を追加する。

## 画面

### `/favorites`

認証済みユーザー専用のお気に入り一覧。

- 保存中の公開クイズ件数
- カテゴリ
- 問題数
- タイトル
- 概要
- 作成者
- 保存日
- 保存解除
- クイズ詳細／プレイ導線
- 12件単位のページング
- loading / empty / error状態

未ログイン時は`/favorites`を復帰先としてログイン画面へ遷移する。

### `/quizzes/{quiz_id}`

公開クイズ詳細へ固定の「あとで遊ぶ」アクションを追加する。

- 未保存: `あとで遊ぶ`
- 保存済み: `保存済み`
- 更新中: `更新中…`
- 未ログインで操作: ログイン後に同じクイズへ復帰
- 非公開クイズ: アクション自体を表示しない

## DB

### `quiz_bookmarks`

| 列 | 型 | 制約 | 用途 |
| --- | --- | --- | --- |
| `user_id` | BIGINT | PK, FK -> users.id, CASCADE | 保存したユーザー |
| `quiz_id` | BIGINT | PK, FK -> quizzes.id, CASCADE | 保存したクイズ |
| `created_at` | TIMESTAMPTZ | NOT NULL | 保存日時 |
| `updated_at` | TIMESTAMPTZ | NOT NULL | 更新日時 |

`user_id + quiz_id`を複合主キーにして同じユーザーによる同一クイズの重複保存をDBレベルで防止する。新しいサロゲートIDは追加しないため、既存の`MAX(id) + 1`採番問題を増やさない。

`quiz_id`にはIndex `ix_quiz_bookmarks_quiz_id`を追加する。

Migration:

- revision: `20260812_0010`
- down revision: `20260804_0009`

## API

すべて認証必須。Cookie認証または既存のBearer JWT互換を利用し、CookieでPUT/DELETEする場合はCSRF二重送信を必須とする。

### `GET /api/me/bookmarks`

本人のお気に入り一覧を返す。

Query:

- `page`: 1以上、既定1
- `per_page`: 1〜50、既定12

公開状態が`published`のクイズだけを返す。保存後に`draft / archived`へ変わったクイズはDBから削除せず一覧からのみ除外する。

レスポンス例:

```json
{
  "items": [
    {
      "bookmarked_at": "2026-08-12T08:00:00+00:00",
      "quiz": {
        "id": "10",
        "title": "AWS基礎クイズ",
        "description_summary": "AWSの基礎を確認します。",
        "category": "技術",
        "question_count": 10,
        "status": "published",
        "author": {
          "id": "2",
          "display_name": "Author"
        }
      }
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 12,
    "total": 1,
    "total_pages": 1
  }
}
```

並び順は`created_at desc`、同時刻時は`quiz_id desc`とする。

### `GET /api/me/bookmarks/{quiz_id}`

指定した公開クイズの本人お気に入り状態を返す。

```json
{
  "quiz_id": "10",
  "bookmarked": true
}
```

非公開・不存在クイズは404 `bookmark/quiz_not_found`。

### `PUT /api/me/bookmarks/{quiz_id}`

公開クイズをお気に入りへ追加する。

初回は201:

```json
{
  "quiz_id": "10",
  "bookmarked": true,
  "meta": { "changed": true }
}
```

既に保存済みの場合は200かつ`changed=false`として冪等に扱う。同時PUTで複合主キー競合が起きた場合も、保存済みであることを再確認できれば成功扱いにする。

非公開・不存在は404。

### `DELETE /api/me/bookmarks/{quiz_id}`

本人のお気に入りを解除する。

クイズ本体の公開状態は確認しない。これにより、保存後に非公開化されたクイズも既知IDから解除できる。

未保存の場合も200かつ`changed=false`として冪等に扱う。

## 公開状態と情報境界

- 新規保存: `published`のみ
- 状態確認: `published`のみ
- 一覧表示: `published`のみ
- 解除: クイズの公開状態を問わない
- 非公開化された保存データは保持し、再公開時に一覧へ復帰できる
- 他ユーザーのお気に入り一覧・状態はAPIで指定できない
- 非公開クイズの状態確認は404にして存在推測を抑える

## テスト観点

### Backend

- 初回保存201
- 重複保存200 / `changed=false`
- 状態取得
- 解除と重複解除
- 本人スコープ
- 保存日時降順
- ページング
- 非公開クイズ一覧除外
- 非公開クイズ保存・状態確認404
- 非公開化後の解除
- 未認証401
- suspendedユーザー403
- Query validation
- 複合主キー・Index
- migration revision連鎖

### Frontend

- 一覧GETのCookie資格情報
- PUT / DELETEのCSRFヘッダー
- 状態GET
- ページング値の正規化
- 保存日時表示
- 前後ページ移動判定
- Production Build

## マージ後作業

本機能はDB migrationを含むため、デプロイ前に対象DBへrevision `20260812_0010`を適用する。

```bash
cd backend
DATABASE_URL='<database url>' flask --app app db upgrade
```

Production適用前にDBバックアップを取得し、Preview環境でmigrationとお気に入り追加／解除を先に確認する。