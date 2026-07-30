# Flask + Reactで「公開後の履歴を壊さない」下書きクイズ編集を実装する

## はじめに

QuizVerseでは、作成したクイズを `draft` として保存し、作成者が確認してから公開する構成にしています。公開管理を実装した後に残った課題は、作成後の下書きを修正できないことでした。

単純に更新APIを追加するだけなら難しくありません。しかし、公開後に回答履歴が保存されたクイズの問題や正答を変更すると、過去のスコアと現在の問題内容が一致しなくなります。

そこで今回は、次の境界を設けました。

- 作成者本人だけが編集できる
- `draft` だけを編集できる
- プレイ履歴が1件でもあれば編集できない
- 問題・選択肢はトランザクション内で全置換する
- 編集データ取得に失敗した画面では空フォームを保存させない

## API設計

編集APIは一般公開APIと分離し、`/api/me/quizzes` 配下へ置きました。

```text
GET /api/me/quizzes/{quiz_id}
PUT /api/me/quizzes/{quiz_id}
```

一般公開のクイズ詳細APIは正答を返しません。一方、編集フォームには現在の正答設定が必要なので、本人向けGETだけが `is_correct` を返します。

## 所有者を404で判定する

本人所有ではないクイズには403ではなく404を返します。

```python
def _owned_quiz_or_404(quiz_id: int, user_id: int):
    quiz = Quiz.query.filter_by(id=quiz_id, author_user_id=user_id).first()
    if not quiz:
        return None, _editing_error("quiz/not_found", "Quiz not found.", 404)
    return quiz, None
```

これにより、他ユーザーがIDを変えながら存在を確認することを防ぎます。

## 編集可能条件を共通化する

GETとPUTの両方で同じ条件を使います。

```python
def _ensure_editable(quiz: Quiz):
    if quiz.status != QuizStatus.draft:
        return _editing_error("quiz/not_editable", "Only draft quizzes can be edited.", 409)

    play_exists = db.session.query(QuizPlay.id).filter(
        QuizPlay.quiz_id == quiz.id
    ).first()
    if play_exists:
        return _editing_error(
            "quiz/edit_conflict",
            "This quiz has play history and cannot be edited.",
            409,
        )
    return None
```

公開中のクイズは一度アーカイブし、下書きへ戻せます。ただし、プレイ履歴がある場合は下書きへ戻しても編集不可です。履歴を維持したまま編集したい場合は、将来的にクイズの版管理が必要になります。

## 作成APIの入力検証を再利用する

作成と編集で入力仕様がずれると、作成できるのに編集できない、またはその逆が発生します。

今回は既存の `_validate_create_quiz_payload` をPUTでも利用しました。

```python
payload = request.get_json(silent=True) or {}
validated, validation_error = _validate_create_quiz_payload(payload)
if validation_error:
    return validation_error
```

タイトル、問題数、選択肢数、正答数などの制約を一元化できます。

## 問題・選択肢をトランザクションで全置換する

MVPでは問題単位の差分更新ではなく、全置換を採用しました。

```python
try:
    Choice.query.filter(Choice.question_id.in_(existing_question_ids)).delete(
        synchronize_session=False
    )
    Question.query.filter(Question.id.in_(existing_question_ids)).delete(
        synchronize_session=False
    )

    quiz.title = validated["title"]
    quiz.description = validated["description"]
    quiz.category = validated["category"]
    quiz.updated_at = datetime.now(timezone.utc)

    # validated questions / choicesを再作成
    db.session.commit()
except Exception:
    db.session.rollback()
```

入力検証を完了してから削除を始め、途中で失敗した場合はロールバックします。

全置換は実装が明快ですが、問題IDが変わります。そのため、プレイ履歴があるクイズでは利用できません。履歴付き編集を実現するなら、問題バージョンやクイズリビジョンを導入する必要があります。

## React側でAPIデータをフォームモデルへ変換する

APIはスネークケース、フォームはReact向けのキャメルケースを使っています。

```javascript
export function buildQuizDraftFromEditableQuiz(quiz) {
  return {
    title: quiz.title ?? '',
    description: quiz.description ?? '',
    category: quiz.category ?? '',
    questions: quiz.questions.map((question) => createQuestion({
      body: question.body,
      explanation: question.explanation,
      choices: question.choices.map((choice) => ({
        body: choice.body,
        isCorrect: choice.is_correct === true,
      })),
    })),
  }
}
```

既存の作成フォームと同じ検証・payload生成を編集画面でも利用できます。

## 読み込み失敗時に空フォームを出さない

編集画面は初期状態として空のフォームモデルを持っています。API取得に失敗したままフォームを表示すると、ユーザーが既存データと誤認して上書きする危険があります。

そのため、次の状態を分離しました。

```text
loading  : 読み込み中
loaded   : 正常取得済み
loadError: 取得失敗
```

`loaded` がtrueになるまで編集フォームを描画せず、失敗時は再試行と一覧へ戻る操作だけを表示します。

## テスト方針

バックエンドでは次を確認しました。

- 本人だけが正答付き編集データを取得できる
- 他ユーザーのGET / PUTは404
- draftを全置換できる
- 入力不正時に既存内容が残る
- published / archivedは409

フロントエンドでは次を確認しました。

- APIデータをフォームモデルへ復元できる
- フォームをPUT payloadへ正規化できる
- GET / PUTへJWT、正しいパス、メソッド、bodyを送る

## まとめ

編集機能では「更新できること」だけでなく、「過去の結果を壊さないこと」が重要です。

MVPでは、draft限定・プレイ履歴なし・全置換という制約によって、実装の単純さと履歴の整合性を両立しました。将来、公開後の編集が必要になった時点で、クイズの版管理へ拡張できる構成です。
