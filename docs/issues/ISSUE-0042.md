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

基本レスポンス:

- クイズ情報
- 得点・正答数・正答率
- 問題本文
- 選択肢
- 本人が選んだ選択肢
- 正誤
- 獲得点

他ユーザーのプレイ、未提出プレイ、不存在IDは情報を区別せず404 `profile/play_not_found`とする。

#### 正答キー・解説の公開条件

提出済みという条件だけでは完全な正答キーを返さない。空回答やほぼ未回答のプレイを提出し、その履歴から公開中クイズの正答を収集して再挑戦できるためである。

完全な正答キーと解説を返す条件は次のいずれかとする。

1. そのプレイが全問正解である
2. クイズが現在再挑戦できない状態（`draft / archived`）である

公開中かつ全問正解ではない場合:

- `review.answer_key_unlocked=false`
- `review.locked_reason="quiz_is_published"`
- `correct_choice_id=null`
- 解説は`null`
- 未選択の正解選択肢を`is_correct=true`にしない
- 本人が選んだ選択肢と、その回答の正誤は表示する

全問正解または再挑戦不可の場合:

- `review.answer_key_unlocked=true`
- 正解選択肢、解説、選択肢ごとの正解フラグを返す

これにより、間違えた箇所の存在は確認できる一方、弱い提出を答え合わせAPIとして利用できない。

## 認証・安全条件

- 全APIをJWT/Cookie認証で保護
- DB上の現在ユーザー状態を確認
- `suspended / withdrawn`は403 `auth/account_inactive`
- 他ユーザーの履歴を取得できない
- メールアドレスは本人のプロフィールAPIだけで返す
- 公開中クイズの正答キーは全問正解時だけ開放する
- 非公開化後は本人の提出済み履歴で完全レビューを許可する
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
- 公開中クイズの正答・解説ロック

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
- 問題別結果
- 他ユーザー詳細404
- 未認証401・停止ユーザー403
- 公開中の空回答で正答キー・解説が漏れない
- 全問正解時は完全レビューを許可する
- アーカイブ後は完全レビューを許可する
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
