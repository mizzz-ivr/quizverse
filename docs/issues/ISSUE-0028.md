# ISSUE-0028: 下書きクイズ編集APIと編集画面を実装する

## 背景

クイズ作成後のタイトル・説明・問題・選択肢・正答を修正するAPIと画面がなく、誤字や正答設定の修正にはクイズを作り直す必要があった。

本Issueでは、作成者本人がプレイ履歴のない下書きを安全に編集できる導線を追加する。

## 編集条件

次の条件をすべて満たすクイズだけを編集できる。

- JWTで認証されたユーザー本人が作成者である
- `Quiz.status == draft`
- `quiz_plays` に対象クイズの履歴が存在しない

本人所有でない場合は存在を推測させないため404を返す。`published / archived` またはプレイ履歴がある場合は409を返す。

公開済みクイズを編集する場合は、公開を終了して下書きへ戻す必要がある。ただし、一度でもプレイ履歴が保存されたクイズは、下書きへ戻しても編集できない。

## API

### `GET /api/me/quizzes/{quiz_id}`

JWT必須。作成者本人の編集可能な下書きを返す。一般公開の詳細APIとは異なり、選択肢に `is_correct` を含める。

```json
{
  "quiz": {
    "id": "12",
    "title": "世界遺産クイズ",
    "description": "初級編",
    "category": "歴史",
    "status": "draft",
    "editable": true,
    "updated_at": "2026-07-30T00:00:00+00:00",
    "questions": [
      {
        "id": "21",
        "body": "富士山の登録区分は？",
        "explanation": "文化的価値が評価されています。",
        "sort_order": 1,
        "points": 1,
        "choices": [
          {
            "id": "41",
            "body": "文化遺産",
            "is_correct": true,
            "sort_order": 1
          }
        ]
      }
    ]
  }
}
```

### `PUT /api/me/quizzes/{quiz_id}`

JWT必須。作成APIと同じ入力契約を利用する。リクエストJSONはオブジェクトでなければならず、配列・文字列・数値は `quiz/validation_error` の400を返す。

```json
{
  "title": "更新後タイトル",
  "description": "更新後の説明",
  "category": "歴史",
  "questions": [
    {
      "body": "更新後の問題",
      "explanation": "更新後の解説",
      "choices": [
        {"body": "正解", "is_correct": true},
        {"body": "不正解", "is_correct": false}
      ]
    }
  ]
}
```

入力制約:

- タイトル: 必須、120文字以内
- 説明: 任意、2000文字以内
- カテゴリ: 任意、80文字以内
- 問題: 1〜50問
- 問題文: 必須、2000文字以内
- 解説: 任意、4000文字以内
- 選択肢: 各問題2〜6件
- 正答: 各問題に1件

## 更新方式

- クイズ本体のIDは維持する
- 問題・選択肢はトランザクション内で全置換する
- クイズ本体の `updated_at` を明示的に更新する
- 入力検証後に削除・再作成を開始する
- 例外発生時はロールバックし、既存内容を維持する
- DBスキーマ変更は行わない

## 競合制御

### 編集・状態変更・プレイ送信

次の3処理は、状態や問題を確認する前に同じ対象クイズ行を `SELECT ... FOR UPDATE` する。

- `PUT /api/me/quizzes/{quiz_id}`
- `PATCH /api/me/quizzes/{quiz_id}/status`
- `POST /api/quizzes/{quiz_id}/play`

ロックは各処理のcommitまたはrollbackまで保持する。

- 状態変更が先に確定した場合: 編集PUTは非 `draft` として409
- 編集が先に確定した場合: 状態変更とプレイ送信は待機後に最新状態を確認
- プレイ送信が先に確定した場合: 編集PUTは保存済みプレイ履歴を確認して409

これにより、進行中プレイが参照している問題・選択肢IDを編集処理が削除する競合を防ぐ。

### 問題・選択肢IDの採番

既存実装は問題・選択肢IDを `MAX(id) + 1` で採番するため、異なるクイズの同時作成・同時編集で同じ次IDを算出する可能性がある。

PostgreSQLではトランザクション単位のadvisory lockを利用する。

```sql
SELECT pg_advisory_xact_lock(7249820371234);
```

クイズ作成POSTと編集PUTだけが、ID算出前に同じadvisory lockを取得し、commitまたはrollbackまで保持する。プレイ送信は問題・選択肢IDを採番しないためadvisory lockを取得せず、対象クイズ行だけをロックする。

advisory lockは外部キー参照先の行ではないため、`QuizPlay.player_user_id` のFK確認と循環待機を起こさず、通常のプレイ送信同士も不要に直列化しない。

SQLiteなどPostgreSQL以外のテスト環境では、互換用に先頭ユーザー行の `FOR UPDATE` へフォールバックする。恒久対応としてはPostgreSQLのsequence / identityへ移行する。

## エラー

| 状況 | HTTP | code |
| --- | ---: | --- |
| 未認証・無効なJWT | 401 | 認証共通エラー |
| 存在しない、または本人所有でない | 404 | `quiz/not_found` |
| draft以外 | 409 | `quiz/not_editable` |
| プレイ履歴あり | 409 | `quiz/edit_conflict` |
| JSONがオブジェクトでない、または入力不正 | 400 | `quiz/validation_error` |
| 更新失敗 | 500 | `quiz/update_failed` |

## フロントエンド

### `/my/quizzes/{quiz_id}/edit`

- JWT確認と編集データ取得を並行実行
- 取得成功後だけフォームを表示
- 取得失敗時は空フォームを表示せず、再試行とマイクイズへ戻る操作を表示
- 既存データを作成フォームと同じクライアントモデルへ変換
- タイトル・説明・カテゴリ・問題・解説・選択肢・正答を編集
- 問題・選択肢の追加と削除
- 保存成功後は `/quizzes/{quiz_id}` の作成者プレビューへ移動

### JWT期限切れ時の編集中データ保持

編集中のフォームはクイズIDごとに `sessionStorage` へ一時保存する。

```text
quizverse_quiz_edit_draft:{quiz_id}
```

保存内容にはフォーム値と取得時点のサーバー `updated_at` を含める。

- JWT期限切れでログインへ遷移しても、同じタブ内では編集中データを保持する
- 再認証後に編集APIを再取得し、サーバー `updated_at` が一致する場合だけ一時データを復元する
- サーバー側が更新されていた場合は古い一時データを破棄する
- PUT成功後は一時データを削除する

これはクライアント内の一時保存であり、サーバーへの自動保存ではない。

### `/my/quizzes`

`draft` カードだけに編集リンクを表示する。公開中・アーカイブ済みカードには直接編集リンクを表示しない。

## セキュリティと整合性

- 作成者判定はJWT identityと `author_user_id` で行う
- 非所有クイズは403ではなく404
- 正答情報は本人向け編集APIだけで返す
- 公開状態とプレイ履歴を更新前に検証する
- 全置換処理は単一トランザクションで実行する
- 編集・状態変更・プレイ送信は対象クイズの同じ行ロック規約を利用する
- 作成・編集の手動ID採番はPostgreSQL advisory lockで直列化する
- プレイ送信は採番advisory lockを利用しない
- 一時保存データはサーバー更新日時が一致する場合だけ復元する

## テスト

```bash
npm --prefix frontend test
npm --prefix frontend run build
cd backend && PYTHONPATH=. pytest
```

検証項目:

- 本人が下書きと正答情報を取得できる
- 他ユーザーのGET / PUTが404
- draftの内容を全置換できる
- 入力不正時に既存内容を維持する
- 非オブジェクトJSONをJSON形式の400で拒否する
- published / archivedを直接編集できない
- プレイ送信前に対象クイズ行ロックを取得する
- プレイ送信が採番advisory lockを取得しない
- APIレスポンスを編集フォームへ復元できる
- 編集フォームをPUT payloadへ正規化できる
- 読み込み失敗時に未取得の空フォームを保存できない
- 同じサーバー更新日時の一時データを再認証後に復元できる
- サーバー更新日時が変わった古い一時データを復元しない
- 保存成功後に一時データを削除できる

## 確認結果

最終CIの実測値をPRマージ前に反映する。

## 対象外

- プレイ履歴があるクイズの版管理編集
- 公開中の即時編集
- 問題単位の差分更新
- 複数ユーザーによる共同編集
- 楽観ロック・編集競合通知
- サーバーへの自動保存
- sequence / identityへの採番方式移行

## 関連

- GitHub Issue #28
- GitHub PR #29
- `backend/app/api/quiz_editing.py`
- `frontend/src/public/EditQuizApp.jsx`
- `frontend/src/public/createQuizModel.js`
