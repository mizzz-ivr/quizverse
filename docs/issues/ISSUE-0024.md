# ISSUE-0024: 一般ユーザー向けクイズ作成UIを実装する

## 背景
一般ユーザー向けMVPでは、登録・ログイン・クイズ検索・回答・ランキング閲覧まで実装済みである。一方、`POST /api/quizzes` は実装済みだが、一般ユーザーがブラウザから利用する入力画面が存在しなかった。

本Issueでは、既存API契約を変更せず、ログイン済みユーザーが選択式クイズを作成できる画面を追加する。

## 画面

### `/quizzes/new`
- タイトル
- カテゴリ（任意）
- 説明（任意）
- 問題文
- 解説（任意）
- 選択肢
- 正答指定
- 問題追加・削除
- 選択肢追加・削除
- 入力内容サマリー
- 作成送信

未ログインの場合はフォームを表示せず、`/login` と `/signup` への導線を表示する。

## API連携

### `POST /api/quizzes`
JWTをAuthorization Headerへ付与し、次の形式で送信する。

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

作成成功後はレスポンスの `quiz.id` を使用し、`/quizzes/{quiz_id}` へ遷移する。

## 入力制約
バックエンドの既存定数と同じ制約をクライアント側でも検証する。

- タイトル: 必須、120文字以内
- 説明: 任意、2000文字以内
- カテゴリ: 任意、80文字以内
- 問題: 1〜50問
- 問題文: 必須、2000文字以内
- 解説: 任意、4000文字以内
- 選択肢: 2〜6件
- 選択肢本文: 必須、1000文字以内
- 正答: 各問題につき1件

クライアント側検証は操作性向上のためのものであり、サーバー側検証を置き換えない。

## UI設計判断

### 独立した作成画面
既存の一般向けアプリは単一ファイルに複数画面がまとまっているため、本Issueでは `CreateQuizApp.jsx` を独立させる。`main.jsx` が `/quizzes/new` を判定して作成画面を表示する。

### 入力モデルの分離
画面から以下を `createQuizModel.js` へ分離する。

- 初期値生成
- クライアントID生成
- 入力検証
- API payload正規化

Reactに依存しない純粋関数として実装し、Node.js標準テストで検証する。

### 正答の保持
正答はラジオボタンで1件のみ指定する。正答に指定された選択肢を削除した場合は、残った先頭の選択肢を正答へ設定し、フォーム内部で正答0件の状態を長時間保持しない。

### 保存状態
既存API仕様に従い、作成結果は `draft` とする。公開状態の切り替えは別Issueで扱う。

## エラー処理
- 未入力はフィールド単位で表示
- 送信前検証失敗は画面上部にも表示
- `quiz/validation_error` は入力内容の再確認を案内
- `quiz/create_failed` は再試行を案内
- 401は既存APIクライアントのセッション失効処理を使用
- 通信エラーは既存の日本語メッセージを使用

## テスト

```bash
npm --prefix frontend test
npm --prefix frontend run build
cd backend && PYTHONPATH=. pytest
```

検証対象:
- 初期状態が1問4択・正答1件
- 必須項目検証
- 正答複数時の拒否
- 空白除去とAPI payload変換
- 任意項目のnull変換
- JWT付きPOSTリクエスト
- 既存フロントエンド回帰
- バックエンド回帰

## 対象外
- 画像・動画
- 下書き一覧・編集
- 公開設定
- 自動保存
- ドラッグ&ドロップ
- 複数正答・記述式
- AI生成

## 関連
- GitHub Issue #24
- `frontend/src/public/CreateQuizApp.jsx`
- `frontend/src/public/createQuizModel.js`
- `frontend/src/public/api.js`
- `POST /api/quizzes`
