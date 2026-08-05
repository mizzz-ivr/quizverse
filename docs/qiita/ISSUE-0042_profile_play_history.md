# Flask + Reactでプロフィールとプレイ履歴を実装する

## はじめに

クイズアプリでは、回答直後のスコア表示だけでなく、利用者が後から実績や間違えた問題を振り返れることが継続利用につながります。

QuizVerseでは、既存の`users`、`quiz_plays`、`quiz_play_answers`を使い、次の機能を追加しました。

- プロフィール表示
- 表示名編集
- 累計成績サマリー
- プレイ履歴
- 問題別の回答結果
- 結果区分フィルター

## 1. 集計対象をsubmittedに限定する

途中離脱や未提出のプレイを成績へ含めると、利用者が見ている数字と実際の完了結果が一致しません。

```python
query = query.filter(
    QuizPlay.player_user_id == current_user.id,
    QuizPlay.status == PlayStatus.submitted,
)
```

プロフィールでは次を集計します。

- プレイ回数
- 挑戦したクイズ数
- 累計正答数
- 累計問題数
- 全問正解回数
- 作成クイズ数

## 2. 平均正答率は加重平均にする

プレイごとの正答率を単純平均すると、1問のクイズと20問のクイズが同じ重みになります。

QuizVerseでは、累計正解数を累計問題数で割ります。

```python
def accuracy(correct_answers, total_questions):
    if total_questions <= 0:
        return 0.0
    return round((correct_answers / total_questions) * 100, 2)
```

これにより、実際に回答した問題数を反映した正答率になります。

## 3. 結果区分をSQLで絞り込む

履歴画面では次の区分を用意しました。

- `perfect`: 100%
- `passed`: 70%以上100%未満
- `review`: 70%未満

```python
passed_expression = and_(
    QuizPlay.total_questions > 0,
    QuizPlay.correct_answers < QuizPlay.total_questions,
    QuizPlay.correct_answers * 100 >= QuizPlay.total_questions * 70,
)
```

小数除算ではなく整数同士の比較にすることで、DBごとの丸め差を避けています。

## 4. 他ユーザーの履歴を404にする

プレイIDだけで検索すると、連番IDから他ユーザーの結果を推測される可能性があります。

```python
row = query.filter(
    QuizPlay.id == play_id,
    QuizPlay.player_user_id == current_user.id,
    QuizPlay.status == PlayStatus.submitted,
).first()
```

他ユーザー、不存在、未提出をすべて404として扱い、違いを外部へ出しません。

## 5. 提出済みだけでは正答キーを開放しない

本人の提出済みプレイであっても、公開中クイズの完全な正答キーを毎回返すのは安全ではありません。

既存の回答APIは未回答を含む提出を許可しているため、次の攻撃が可能になるからです。

1. 全問を空欄のまま提出する
2. 履歴詳細APIから正解と解説を取得する
3. 同じ公開クイズへ再挑戦する
4. 取得した正解で満点を取る

そこで、完全な正答キーと解説を開放する条件を次のいずれかに限定しました。

- そのプレイが全問正解
- クイズが`draft / archived`で再挑戦できない

```python
perfect_attempt = (
    total_questions > 0
    and correct_answers == total_questions
)
review_unlocked = not quiz.is_replayable or perfect_attempt
```

公開中かつ全問正解ではないプレイでは、本人が選択した内容と問題ごとの正誤だけを返します。

```json
{
  "review": {
    "answer_key_unlocked": false,
    "locked_reason": "quiz_is_published"
  },
  "questions": [
    {
      "selected_choice_id": null,
      "result": "skipped",
      "correct_choice_id": null,
      "explanation": null
    }
  ]
}
```

未選択の正解候補へ`is_correct=true`も付けません。選択済みで正解だった選択肢だけは、すでに問題単位の`result=correct`で判明しているため表示できます。

全問正解者に完全レビューを許可しても、新しい答えを開示することにはなりません。また、アーカイブ後は再挑戦できないため学習用の完全レビューを許可できます。

## 6. 非公開クイズの過去結果を残す

クイズが後からアーカイブされても、利用者の学習記録まで消す必要はありません。

履歴では過去結果を表示しつつ、現在の状態から再挑戦可否を返します。

```json
{
  "quiz": {
    "status": "archived",
    "is_replayable": false
  }
}
```

React側では履歴を表示し、再挑戦ボタンだけを非表示にします。アーカイブ後は正答キーと解説を含む完全レビューも利用できます。

## 7. 表示名更新は同一値も成功扱いにする

表示名は前後空白を除去し、1〜80文字へ制限します。

```python
normalized = display_name.strip()
if normalized == current_user.display_name:
    return {
        "user": serialize_user(current_user),
        "meta": {"changed": False},
    }
```

同一値でエラーにしないため、再送や二重クリックにも扱いやすいAPIになります。

## 8. Cookie認証とCSRFを維持する

プロフィール画面も既存のHttpOnly Cookie認証を使います。

- GET: `credentials: same-origin`
- PATCH: `credentials: same-origin`
- PATCH: CSRF Cookieを`X-CSRF-TOKEN`へ設定
- 401: 既存refresh処理を実行して再試行

JWTをJavaScriptから読み取ったり、localStorageへ保存したりしません。

## 9. React画面の構成

`/profile`では次を表示します。

- ユーザーヘッダー
- 表示名編集フォーム
- 実績カード
- 結果フィルター
- プレイ履歴カード
- 回答結果サイドパネル
- 前後ページング

履歴詳細を別ページではなくサイドパネルにすることで、一覧の検索条件やページ位置を維持したまま振り返れます。

正答キーがロックされている場合でも、本人が選んだ回答、正誤、獲得点は表示します。完全レビューの開放条件はAPIレスポンスの`review.answer_key_unlocked`で判断できます。

## テスト観点

バックエンドでは次を確認します。

- submittedだけを集計
- 加重平均
- 本人スコープ
- 新しい順
- ページング
- 結果区分
- 非公開クイズの再挑戦不可
- 問題別結果
- 他ユーザー404
- 未認証401
- 停止ユーザー403
- 公開中の空回答で正答キーが漏れない
- 全問正解時は完全レビューできる
- アーカイブ後は完全レビューできる

フロントエンドでは次を確認します。

- APIのCookie資格情報
- PATCHのCSRFヘッダー
- 履歴クエリ
- 統計値の正規化
- 正答率表示
- 結果ラベル
- ページ移動可否
- Production Build

## まとめ

- 完了済みプレイだけを成績へ含める
- 平均正答率は問題数を反映した加重平均にする
- 履歴取得は必ず本人IDで絞る
- 提出済みという理由だけで公開中クイズの正答キーを返さない
- 全問正解または再挑戦不可のときだけ完全レビューを許可する
- 非公開後も過去結果を維持する
- Cookie認証とCSRFをプロフィール機能でも統一する

プロフィールとプレイ履歴は単なる表示画面ではなく、学習記録の整合性と回答情報の公開境界を守る機能として設計することが重要です。
