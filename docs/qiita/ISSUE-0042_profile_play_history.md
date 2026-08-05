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

## 5. 回答詳細は提出後だけ返す

クイズ回答前に正解や解説が取得できると、採点機能を回避できます。

回答詳細APIでは、本人の`submitted`プレイが確認できた後にだけ次を返します。

- 選択した選択肢
- 正解選択肢
- 正誤
- 獲得点
- 解説

公開クイズ詳細APIとは責務を分けます。

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

React側では履歴を表示し、再挑戦ボタンだけを非表示にします。

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
- 正答と解説は本人の提出後だけ返す
- 非公開後も過去結果は維持し、再挑戦だけ無効にする
- Cookie認証とCSRFをプロフィール機能でも統一する

プロフィールとプレイ履歴は単なる表示画面ではなく、学習記録の整合性と回答情報の公開境界を守る機能として設計することが重要です。
