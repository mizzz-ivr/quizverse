# ISSUE-0042 プロフィール・成績サマリー・プレイ履歴

## 背景

QuizVerseではクイズの作成、公開、回答、ランキングまで実装済みだが、利用者が自分の活動を振り返るマイページがなかった。

継続利用しやすくするため、本人のプロフィール、累計実績、提出済みプレイ履歴、問題別の回答結果を確認できる機能を追加する。

## 画面

### `/profile`

認証済みユーザー専用のプロフィール画面。

- 表示名・メール・登録日・最終ログイン
- 表示名編集
- 平均正答率
- プレイ回数
- 挑戦したクイズ数
- 累計正解数
- 全問正解回数
- 作成クイズ数
- プレイ履歴
- 結果区分フィルター
- ページング
- 回答結果サイドパネル
- クイズ詳細・再挑戦導線

PCでは複数カラムの実績カード、モバイルでは1カラム中心のレイアウトに切り替える。

## API

### `GET /api/me/profile`

本人情報と提出済みプレイの集計を返す。

```json
{
  "user": {
    "id": "1",
    "email": "user@example.com",
    "display_name": "Quiz Player",
    "avatar_url": null,
    "role": "user",
    "status": "active",
    "created_at": "2026-08-05T00:00:00+00:00",
    "last_login_at": null
  },
  "stats": {
    "play_count": 4,
    "attempted_quiz_count": 3,
    "correct_answers": 8,
    "total_questions": 10,
    "average_accuracy_percentage": 80.0,
    "perfect_play_count": 2,
    "created_quiz_count": 1
  }
}
```

平均正答率は、プレイごとの平均ではなく累計正解数÷累計問題数の加重平均とする。`started`や`abandoned`は集計しない。

### `PATCH /api/me/profile`

表示名を更新する。

```json
{
  "display_name": "New Name"
}
```

- 前後空白を除去
- 1〜80文字
- 同じ値は200、`meta.changed=false`
- 更新時はCookie認証のCSRF二重送信を適用

### `GET /api/me/plays`

本人の`submitted`プレイを新しい順で返す。

クエリ:

- `page`: 1以上
- `per_page`: 1〜50
- `quiz_id`: 任意のクイズID
- `result`: `all / perfect / passed / review`

結果区分:

- `perfect`: 正答率100%
- `passed`: 100%未満かつ70%以上
- `review`: 70%未満または問題数0

非公開・アーカイブ済みクイズの過去結果も本人には表示する。`quiz.is_replayable`は現在`published`の場合だけ`true`とする。

### `GET /api/me/plays/{play_id}`

本人の提出済みプレイだけを返す。

- クイズ情報
- 得点・正答数・正答率
- 問題本文
- 選択肢
- 本人が選んだ選択肢
- 正解選択肢
- 正誤
- 獲得点
- 解説

他ユーザーのプレイ、未提出プレイ、不存在IDは情報を区別せず404 `profile/play_not_found`とする。

## 認証・安全条件

- 全APIをJWT/Cookie認証で保護
- DB上の現在ユーザー状態を確認
- `suspended / withdrawn`は403 `auth/account_inactive`
- 他ユーザーの履歴を取得できない
- 正答と解説は本人の提出済み詳細だけで返す
- メールアドレスは本人のプロフィールAPIだけで返す
- フロントエンドはHttpOnly Cookieを利用し、JWTをlocalStorageへ保存しない

## フロントエンド状態

- 初期読み込み
- 履歴再読み込み
- 空履歴
- APIエラー
- 表示名保存中・成功・失敗
- 詳細読み込み・失敗
- 前後ページ移動不可
- 非公開クイズの再挑戦不可

## DB変更

追加migrationは不要。既存の次のテーブルを使用する。

- `users`
- `quizzes`
- `quiz_plays`
- `quiz_play_answers`
- `questions`
- `choices`

## テスト対象

- 本人プロフィールと加重平均集計
- `submitted`以外を集計しない
- 表示名の空白除去・同一値・不正値
- 履歴の本人スコープ
- 新しい順・ページング
- `perfect / passed / review`フィルター
- 非公開クイズの`is_replayable=false`
- 問題別結果・正解・解説
- 他ユーザー詳細404
- 未認証401・停止ユーザー403
- Cookie・CSRF付きAPIクライアント
- 画面表示モデル
- Production Build

## 対象外

- メールアドレス変更
- パスワード変更
- アバター画像アップロード
- プロフィール公開ページ
- フォロー機能
- プレイ履歴削除
- 問題・選択肢の履歴スナップショット保存
