# Flask + Reactで「公開後の履歴を壊さない」下書きクイズ編集を実装する

## はじめに

QuizVerseでは、作成したクイズを `draft` として保存し、作成者が確認してから公開する構成にしています。公開管理を実装した後に残った課題は、作成後の下書きを修正できないことでした。

単純に更新APIを追加するだけなら難しくありません。しかし、公開後に回答履歴が保存されたクイズの問題や正答を変更すると、過去のスコアと現在の問題内容が一致しなくなります。

そこで今回は、次の境界を設けました。

- 作成者本人だけが編集できる
- `draft` だけを編集できる
- プレイ履歴が1件でもあれば編集できない
- 問題・選択肢はトランザクション内で全置換する
- 編集と公開状態変更を同じ行ロック規約で直列化する
- 手動ID採番を共有ロックで直列化する
- 編集データ取得に失敗した画面では空フォームを保存させない
- JWT期限切れ後も同じタブ内の未保存編集を復元する

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

## 編集と公開を同じ行ロックで直列化する

編集PUTだけがクイズ行をロックしても、公開状態PATCHがロックせずに古い `draft` を読めば競合を防げません。

そこで両方の処理が、状態確認より前に同じ対象クイズ行へ `SELECT ... FOR UPDATE` を行うようにしました。

```text
編集PUT                      状態変更PATCH
   │                               │
   ├─ 対象Quiz行をFOR UPDATE       ├─ 対象Quiz行をFOR UPDATE
   ├─ draft / play履歴確認          ├─ 現在状態 / 公開条件確認
   ├─ 全置換                       ├─ 状態更新
   └─ commit                       └─ commit
```

どちらか一方がロックを取得すると、もう一方はcommitまで待機します。待機後は確定済みの最新状態を前提に検証するため、編集中に古い問題構造を公開する競合を防げます。

## `MAX(id) + 1` 採番も共有ロックで直列化する

既存実装は問題・選択肢IDを `MAX(id) + 1` で採番しています。異なるクイズを同時編集すると、対象クイズ行が異なるため同じ次IDを計算する可能性があります。

MVPでは、最小IDのユーザー行を共有採番ロックとして使用しました。

```python
def _lock_shared_id_allocation_row():
    return (
        db.session.query(User.id)
        .order_by(User.id.asc())
        .with_for_update()
        .first()
    )
```

クイズ作成と下書き編集は、採番前に同じ共有行をロックし、ID算出からcommitまで直列化します。

これは既存方式との互換性を優先した暫定策です。恒久的にはPostgreSQLのsequence / identityへ移行する方が自然です。

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

## JWT期限切れ後も未保存編集を復元する

PUT送信時にJWTが期限切れだと、共通APIクライアントはセッションを削除してログイン画面へ遷移します。このときフォームを保存していなければ、再認証後に未保存の編集が失われます。

クイズIDごとのキーで `sessionStorage` へフォームを一時保存します。

```text
quizverse_quiz_edit_draft:{quiz_id}
```

一時保存には、フォーム値だけでなく、編集APIから取得した `updated_at` も含めます。

```javascript
saveEditableQuizDraft(quizId, serverUpdatedAt, draft)
```

再認証後は、サーバーから最新データを取得して次のように判定します。

- 一時保存時とサーバーの `updated_at` が一致: 未保存編集を復元
- 一致しない: 他の更新があった可能性があるため一時保存を破棄
- PUT成功: 一時保存を削除

これにより、期限切れ時のデータ損失を防ぎつつ、古いローカルデータで新しいサーバー状態を上書きしません。

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
- 同じサーバー更新日時なら一時保存を復元する
- 更新日時が変わった古い一時保存を破棄する
- PUT成功後に一時保存を削除する

最終結果は次の通りです。

```text
frontend: 34 passed, 0 failed
backend : 65 passed, 1 warning
build   : success
```

## まとめ

編集機能では「更新できること」だけでなく、「過去の結果を壊さないこと」と「競合時に古い状態を公開しないこと」が重要です。

MVPでは、draft限定・プレイ履歴なし・全置換・共通ロック・再認証用一時保存という制約によって、実装の単純さと履歴の整合性を両立しました。将来、公開後の編集が必要になった時点で、クイズの版管理とDB sequence / identityへ拡張できる構成です。
