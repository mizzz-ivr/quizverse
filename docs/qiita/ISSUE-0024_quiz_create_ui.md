# Reactで動的なクイズ作成フォームを実装する：1〜50問・2〜6択・正答1件を安全に扱う

## はじめに
QuizVerseでは、Flask側にクイズ作成APIが実装済みでしたが、一般ユーザーがブラウザから問題を作成する画面がありませんでした。

本記事では、React + Tailwind CSSのフロントエンドから既存の `POST /api/quizzes` に接続し、次の要件を満たす動的フォームを実装した方法を整理します。

- 問題を1〜50問追加
- 各問題に2〜6件の選択肢
- 正答は各問題につき1件
- 問題・選択肢の追加と削除
- 送信前のクライアント検証
- JWT付きAPIリクエスト
- React非依存の入力モデルを単体テスト

## API契約を先に確認する
フロントエンドのフォーム設計は、バックエンドの入力契約を基準にします。

```json
{
  "title": "世界遺産クイズ",
  "description": "初級編",
  "category": "歴史",
  "questions": [
    {
      "body": "富士山が登録された世界遺産区分は？",
      "explanation": "文化的価値が評価されています。",
      "choices": [
        { "body": "自然遺産", "is_correct": false },
        { "body": "文化遺産", "is_correct": true }
      ]
    }
  ]
}
```

サーバー側では次を検証します。

- タイトルは必須
- 問題は1〜50問
- 選択肢は2〜6件
- 選択肢本文は必須
- 正答は各問題につき1件

クライアント側でも同じ制約を確認しますが、サーバー側検証は必ず残します。

## React stateとAPI payloadを分離する
画面上では、問題や選択肢を削除してもReactのkeyが安定するよう、APIには送信しない `clientId` を持たせます。

```js
{
  clientId: 'question-...',
  body: '',
  explanation: '',
  choices: [
    {
      clientId: 'choice-...',
      body: '',
      isCorrect: true,
    }
  ]
}
```

送信時に `clientId` を除外し、バックエンドのsnake_caseへ変換します。

```js
export function buildCreateQuizPayload(draft) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    category: draft.category.trim() || null,
    questions: draft.questions.map((question) => ({
      body: question.body.trim(),
      explanation: question.explanation.trim() || null,
      choices: question.choices.map((choice) => ({
        body: choice.body.trim(),
        is_correct: choice.isCorrect === true,
      })),
    })),
  }
}
```

## 正答はboolean配列ではなくラジオ操作で更新する
データ構造は各選択肢に `isCorrect` を持たせていますが、UIではラジオボタンを使います。

正答を変更するときは、対象だけをtrueにし、残りをfalseへします。

```js
choices: question.choices.map((choice, index) => ({
  ...choice,
  isCorrect: index === selectedIndex,
}))
```

これにより、通常操作で複数正答が発生しません。

ただし、入力モデルの検証では必ず正答数を数えます。

```js
if (choices.filter((choice) => choice.isCorrect === true).length !== 1) {
  error.correctChoice = '正解を1つ選択してください。'
}
```

UI制御だけに依存しないことで、state変更や将来の機能追加による不整合を検出できます。

## 正答の選択肢を削除したときの扱い
正答に設定された選択肢を削除すると、正答0件になります。

今回は、削除後に残った先頭選択肢を正答へ設定しました。

```js
const removedWasCorrect = choices[choiceIndex].isCorrect
const nextChoices = choices.filter((_, index) => index !== choiceIndex)

if (removedWasCorrect && nextChoices.length > 0) {
  nextChoices[0] = { ...nextChoices[0], isCorrect: true }
}
```

送信時にエラーを出すだけでなく、フォーム内部の不正状態を可能な範囲で自動修復しています。

## 入力検証をReactから分離する
入力検証をコンポーネント内へ直接書くと、テストにDOM環境が必要になります。

そこで次を純粋関数として分離しました。

- 初期値生成
- 入力検証
- API payload変換

```js
const validation = validateQuizDraft(draft)

if (!validation.valid) {
  // フィールド別エラーを表示
}
```

この構成ならNode.js標準の `node:test` だけでテストできます。

## JWT付きで作成APIを呼ぶ
APIクライアントへ作成メソッドを追加します。

```js
createQuiz: (values, accessToken) => request('/api/quizzes', {
  method: 'POST',
  body: values,
  accessToken,
})
```

共通request関数がAuthorization Headerを設定します。

```js
if (accessToken) {
  headers.Authorization = `Bearer ${accessToken}`
}
```

401時は既存のセッション失効処理を再利用し、作成画面だけ独自の認証処理を増やしません。

## ルーティングを既存構成へ合わせる
QuizVerseのMVPはルーティングライブラリを使わず、初期pathnameで表示するアプリを分けています。

```js
if (pathname === '/quizzes/new') RootApp = CreateQuizApp
```

将来的にReact Router等を導入する場合は、一般画面・作成画面・管理画面を共通ルーターへ統合する予定です。

## テスト
今回追加したテストは次のとおりです。

- 初期状態が1問4択・正答1件
- 必須項目が空の場合は無効
- 複数正答を拒否
- 空白除去とsnake_case変換
- 任意項目をnullへ変換
- JWT付きPOSTリクエスト

```bash
npm --prefix frontend test
npm --prefix frontend run build
cd backend && PYTHONPATH=. pytest
```

## 今後の改善
今回のスコープには含めていませんが、次の改善が考えられます。

- 下書き一覧と編集
- 自動保存
- 公開・非公開設定
- ドラッグ&ドロップによる並べ替え
- 画像・動画添付
- 複数正答・記述式
- AIによる問題生成
- HttpOnly Cookieとrefresh token

## まとめ
動的な作成フォームでは、単に入力欄を増減できるだけでなく、データ構造の整合性を保つことが重要です。

特に次の3点を分離すると、実装とテストが整理しやすくなります。

1. React表示用state
2. 入力検証
3. API送信用payload

バックエンド契約を基準にしつつ、UI操作で不正状態を作りにくくし、送信直前にも純粋関数で検証する構成が有効でした。
